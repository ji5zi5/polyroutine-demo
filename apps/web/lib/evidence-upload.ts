import { ApiAbortError, ApiClientError, ApiNetworkError, uploadEvidence } from "./api"
import type { Account, EvidenceChallenge, Goal } from "./contracts"
import { clearIdempotencyKey, getOrCreateIdempotencyKey } from "./session-storage"

type EvidenceUploadCommand = {
  readonly account: Account
  readonly challenge: EvidenceChallenge
  readonly file: File
  readonly goal: Goal
}

export type EvidenceUploadResult =
  | { readonly kind: "challenge_expired"; readonly message: string }
  | { readonly kind: "closed"; readonly message: string }
  | { readonly kind: "rejected"; readonly message: string }
  | { readonly kind: "receipt"; readonly receiptId: string }
  | { readonly kind: "transport_unknown"; readonly message: string }

export async function sendEvidenceUpload(
  command: EvidenceUploadCommand,
  signal: AbortSignal,
): Promise<EvidenceUploadResult> {
  try {
    const receipt = await uploadEvidence(
      {
        challengeCode: command.challenge.code,
        file: command.file,
        goalId: command.goal.id,
        idempotencyKey: getOrCreateIdempotencyKey(
          "evidence",
          command.account.subjectKey,
          command.goal.id,
        ),
        subjectKey: command.account.subjectKey,
      },
      signal,
    )
    clearIdempotencyKey("evidence", command.account.subjectKey, command.goal.id)
    return { kind: "receipt", receiptId: receipt.receipt_id }
  } catch (error) {
    if (error instanceof ApiAbortError || error instanceof ApiNetworkError) {
      return {
        kind: "transport_unknown",
        message: "서버 영수증을 확인하지 못했습니다. 같은 업로드 키로 접수 여부를 확인하세요.",
      }
    }
    if (error instanceof ApiClientError && error.code === "CHALLENGE_EXPIRED") {
      clearIdempotencyKey("evidence", command.account.subjectKey, command.goal.id)
      return {
        kind: "challenge_expired",
        message: "10분 코드가 만료되었습니다. 새 코드로 다시 촬영하세요.",
      }
    }
    if (error instanceof ApiClientError && error.code === "EVIDENCE_DEADLINE") {
      clearIdempotencyKey("evidence", command.account.subjectKey, command.goal.id)
      return {
        kind: "closed",
        message: "증거 제출 마감이 지났습니다. 사진은 저장되지 않았습니다.",
      }
    }
    if (error instanceof ApiClientError && error.code === "EVIDENCE_ATTEMPTS_EXHAUSTED") {
      clearIdempotencyKey("evidence", command.account.subjectKey, command.goal.id)
      return { kind: "closed", message: "두 번의 제출 기회를 모두 사용했습니다." }
    }
    if (error instanceof ApiClientError && error.status >= 500) {
      return {
        kind: "transport_unknown",
        message: "저장소 연결을 확인하지 못했습니다. 같은 사진으로 다시 확인하세요.",
      }
    }
    if (error instanceof ApiClientError) {
      clearIdempotencyKey("evidence", command.account.subjectKey, command.goal.id)
      return {
        kind: "rejected",
        message: "사진을 접수하지 않았습니다. 형식과 제출 기회를 확인하세요.",
      }
    }
    throw error
  }
}
