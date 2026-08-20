import {
  ApiAbortError,
  ApiClientError,
  ApiNetworkError,
  completeEvidenceUpload,
  prepareEvidenceUpload,
} from "./api"
import type { Account, EvidenceChallenge, Goal } from "./contracts"
import { clearIdempotencyKey, getOrCreateIdempotencyKey } from "./session-storage"

type EvidenceUploadCommand = {
  readonly account: Account
  readonly challenge: EvidenceChallenge
  readonly continuation: EvidenceUploadContinuation | null
  readonly file: File
  readonly goal: Goal
  readonly onProgress: (progress: EvidenceUploadProgress) => void
}

export type EvidenceUploadContinuation = {
  readonly bytesUploaded: boolean
  readonly uploadId: string
}

export type EvidenceUploadProgress = {
  readonly loaded: number
  readonly total: number
}

export type EvidenceUploadResult =
  | { readonly kind: "challenge_expired"; readonly message: string }
  | { readonly kind: "closed"; readonly message: string }
  | { readonly kind: "rejected"; readonly message: string }
  | { readonly kind: "receipt"; readonly receiptId: string }
  | {
      readonly continuation: EvidenceUploadContinuation | null
      readonly kind: "transport_unknown"
      readonly message: string
    }

class ObjectUploadAbortError extends Error {
  override readonly name = "ObjectUploadAbortError"
}

class ObjectUploadNetworkError extends Error {
  override readonly name = "ObjectUploadNetworkError"
}

class ObjectUploadResponseError extends Error {
  override readonly name = "ObjectUploadResponseError"

  constructor(readonly status: number) {
    super(`Object upload returned HTTP ${status}`)
  }
}

function uploadObject(
  targetUrl: string,
  file: File,
  signal: AbortSignal,
  onProgress: (progress: EvidenceUploadProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    const abort = (): void => request.abort()
    request.open("PUT", targetUrl)
    request.setRequestHeader("content-type", "application/octet-stream")
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress({ loaded: event.loaded, total: event.total })
    })
    request.addEventListener("load", () => {
      signal.removeEventListener("abort", abort)
      if (request.status >= 200 && request.status < 300) {
        onProgress({ loaded: file.size, total: file.size })
        resolve()
        return
      }
      reject(new ObjectUploadResponseError(request.status))
    })
    request.addEventListener("error", () => {
      signal.removeEventListener("abort", abort)
      reject(new ObjectUploadNetworkError("The object upload response could not be confirmed"))
    })
    request.addEventListener("abort", () => {
      signal.removeEventListener("abort", abort)
      reject(new ObjectUploadAbortError("The object upload was cancelled"))
    })
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) {
      request.abort()
      return
    }
    request.send(file)
  })
}

export async function sendEvidenceUpload(
  command: EvidenceUploadCommand,
  signal: AbortSignal,
): Promise<EvidenceUploadResult> {
  const idempotencyKey = getOrCreateIdempotencyKey(
    "evidence",
    command.account.subjectKey,
    command.goal.id,
  )
  let continuation = command.continuation
  try {
    if (continuation === null || !continuation.bytesUploaded) {
      const target = await prepareEvidenceUpload(
        {
          challengeCode: command.challenge.code,
          file: command.file,
          goalId: command.goal.id,
          idempotencyKey,
          subjectKey: command.account.subjectKey,
        },
        signal,
      )
      continuation = { bytesUploaded: false, uploadId: target.uploadId }
      await uploadObject(target.uploadUrl, command.file, signal, command.onProgress)
      continuation = { bytesUploaded: true, uploadId: target.uploadId }
    }
    const receipt = await completeEvidenceUpload(
      {
        challengeCode: command.challenge.code,
        goalId: command.goal.id,
        subjectKey: command.account.subjectKey,
        uploadId: continuation.uploadId,
      },
      signal,
    )
    clearIdempotencyKey("evidence", command.account.subjectKey, command.goal.id)
    return { kind: "receipt", receiptId: receipt.receipt_id }
  } catch (error) {
    if (
      error instanceof ApiAbortError ||
      error instanceof ApiNetworkError ||
      error instanceof ObjectUploadAbortError ||
      error instanceof ObjectUploadNetworkError ||
      error instanceof ObjectUploadResponseError
    ) {
      return {
        continuation,
        kind: "transport_unknown",
        message: "서버 영수증을 확인하지 못했어요. 같은 업로드 키로 접수 여부를 확인해 주세요.",
      }
    }
    if (error instanceof ApiClientError && error.code === "UPLOAD_NOT_FOUND") {
      return {
        continuation:
          continuation === null ? null : { bytesUploaded: false, uploadId: continuation.uploadId },
        kind: "transport_unknown",
        message: "사진 전송을 확인하지 못했어요. 같은 업로드 키로 다시 전송해 주세요.",
      }
    }
    if (error instanceof ApiClientError && error.code === "CHALLENGE_EXPIRED") {
      clearIdempotencyKey("evidence", command.account.subjectKey, command.goal.id)
      return {
        kind: "challenge_expired",
        message: "10분 코드가 만료됐어요. 새 코드로 다시 촬영해 주세요.",
      }
    }
    if (error instanceof ApiClientError && error.code === "EVIDENCE_DEADLINE") {
      clearIdempotencyKey("evidence", command.account.subjectKey, command.goal.id)
      return {
        kind: "closed",
        message: "증거 제출 마감이 지났어요. 사진은 저장하지 않았어요.",
      }
    }
    if (error instanceof ApiClientError && error.code === "EVIDENCE_ATTEMPTS_EXHAUSTED") {
      clearIdempotencyKey("evidence", command.account.subjectKey, command.goal.id)
      return { kind: "closed", message: "두 번의 제출 기회를 모두 사용했어요." }
    }
    if (error instanceof ApiClientError && error.status >= 500) {
      return {
        continuation,
        kind: "transport_unknown",
        message: "저장소 연결을 확인하지 못했어요. 같은 업로드 키로 다시 확인해 주세요.",
      }
    }
    if (error instanceof ApiClientError) {
      clearIdempotencyKey("evidence", command.account.subjectKey, command.goal.id)
      return {
        kind: "rejected",
        message: "사진을 접수하지 않았어요. 형식과 제출 기회를 확인해 주세요.",
      }
    }
    throw error
  }
}
