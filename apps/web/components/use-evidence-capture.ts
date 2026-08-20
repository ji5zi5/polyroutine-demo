"use client"

import { useEffect, useRef, useState } from "react"
import {
  ApiClientError,
  ApiNetworkError,
  cancelEvidenceUpload,
  requestEvidenceChallenge,
} from "../lib/api"
import type { Account, EvidenceChallenge, Goal } from "../lib/contracts"
import {
  type EvidenceUploadContinuation,
  type EvidenceUploadProgress,
  sendEvidenceUpload,
} from "../lib/evidence-upload"
import { clearIdempotencyKey } from "../lib/session-storage"
import { useEvidenceStatus } from "./use-evidence-status"

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"])

export type LocalEvidencePhoto = {
  readonly file: File
  readonly previewUrl: string
}

type CaptureMessage = Readonly<{ kind: "error" | "info"; text: string }>

type EvidenceCaptureOptions = {
  readonly account: Account
  readonly goal: Goal
  readonly online: boolean
}

export function useEvidenceCapture({ account, goal, online }: EvidenceCaptureOptions) {
  const [challenge, setChallenge] = useState<EvidenceChallenge | null>(null)
  const [challengeExpired, setChallengeExpired] = useState(false)
  const [consent, setConsent] = useState(false)
  const [captureClosed, setCaptureClosed] = useState(false)
  const [message, setMessage] = useState<CaptureMessage | null>(null)
  const [photo, setPhoto] = useState<LocalEvidencePhoto | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const status = useEvidenceStatus(account, goal, online)
  const [transportRetry, setTransportRetry] = useState(false)
  const [uploadContinuation, setUploadContinuation] = useState<EvidenceUploadContinuation | null>(
    null,
  )
  const [uploadProgress, setUploadProgress] = useState<EvidenceUploadProgress | null>(null)
  const [uploading, setUploading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const cancelRequestedRef = useRef(false)

  useEffect(() => {
    const previewUrl = photo?.previewUrl
    return () => {
      if (previewUrl !== undefined) URL.revokeObjectURL(previewUrl)
    }
  }, [photo])

  useEffect(() => {
    if (challenge === null) {
      setRemainingSeconds(0)
      return
    }
    const duration = Math.max(0, Date.parse(challenge.expiresAt) - Date.parse(challenge.issuedAt))
    const startedAt = performance.now()
    const update = (): void => {
      const next = Math.max(0, Math.ceil((duration - (performance.now() - startedAt)) / 1_000))
      setRemainingSeconds(next)
      if (next === 0) {
        setChallengeExpired(true)
        setPhoto(null)
      }
    }
    update()
    const interval = window.setInterval(update, 250)
    return () => window.clearInterval(interval)
  }, [challenge])

  const beginChallenge = async (): Promise<void> => {
    if (!consent || !online || goal.state !== "evidence_open") return
    clearIdempotencyKey("evidence", account.subjectKey, goal.id)
    setUploadContinuation(null)
    setUploadProgress(null)
    setPreparing(true)
    setMessage(null)
    status.clearMessage()
    setChallengeExpired(false)
    setPhoto(null)
    try {
      setChallenge(await requestEvidenceChallenge(account.subjectKey, goal.id))
    } catch (error) {
      if (error instanceof ApiNetworkError) {
        setMessage({
          kind: "error",
          text: "서버 코드를 받지 못했어요. 연결 후 다시 준비해 주세요.",
        })
        return
      }
      if (error instanceof ApiClientError) {
        setMessage({ kind: "error", text: "지금은 새 증거 코드를 만들 수 없어요." })
        return
      }
      throw error
    } finally {
      setPreparing(false)
    }
  }

  const selectPhoto = (file: File): void => {
    setMessage(null)
    status.clearMessage()
    setUploadProgress(null)
    if (!acceptedImageTypes.has(file.type) || file.size > MAX_IMAGE_BYTES) {
      setPhoto(null)
      setMessage({
        kind: "error",
        text: "8 MiB 이하 JPEG, PNG, WebP 사진 한 장을 선택해 주세요.",
      })
      return
    }
    setPhoto({ file, previewUrl: URL.createObjectURL(file) })
  }

  const submitPhoto = async (): Promise<void> => {
    if (challenge === null || photo === null || challengeExpired || !online) return
    const controller = new AbortController()
    abortRef.current = controller
    cancelRequestedRef.current = false
    setUploading(true)
    setMessage(null)
    status.clearMessage()
    setTransportRetry(false)
    setUploadProgress(null)
    try {
      const result = await sendEvidenceUpload(
        {
          account,
          challenge,
          continuation: uploadContinuation,
          file: photo.file,
          goal,
          onProgress: setUploadProgress,
        },
        controller.signal,
      )
      if (cancelRequestedRef.current) {
        if (result.kind === "transport_unknown" && result.continuation !== null) {
          try {
            await cancelEvidenceUpload(account.subjectKey, goal.id, result.continuation.uploadId)
          } catch (error) {
            if (error instanceof ApiClientError || error instanceof ApiNetworkError) {
              setUploadContinuation(result.continuation)
              setTransportRetry(true)
              setMessage({
                kind: "error",
                text: "업로드 취소를 확인하지 못했어요. 같은 업로드 키로 상태를 확인해 주세요.",
              })
              return
            }
            throw error
          }
        }
        clearIdempotencyKey("evidence", account.subjectKey, goal.id)
        setUploadContinuation(null)
        setPhoto(null)
        setMessage({ kind: "info", text: "업로드를 취소했어요. 사진은 접수하지 않았어요." })
        return
      }
      switch (result.kind) {
        case "receipt":
          status.acceptReceipt(result.receiptId)
          setChallenge(null)
          setPhoto(null)
          setUploadContinuation(null)
          return
        case "transport_unknown":
          setUploadContinuation(result.continuation)
          setTransportRetry(true)
          setMessage({ kind: "error", text: result.message })
          return
        case "challenge_expired":
          setChallengeExpired(true)
          setPhoto(null)
          setUploadContinuation(null)
          setMessage({ kind: "error", text: result.message })
          return
        case "closed":
          setCaptureClosed(true)
          setChallenge(null)
          setPhoto(null)
          setUploadContinuation(null)
          setMessage({ kind: "error", text: result.message })
          return
        case "rejected":
          setUploadContinuation(null)
          setMessage({ kind: "error", text: result.message })
          return
        default: {
          const unexpected: never = result
          throw new TypeError(`unexpected evidence upload result: ${JSON.stringify(unexpected)}`)
        }
      }
    } finally {
      abortRef.current = null
      cancelRequestedRef.current = false
      setUploadProgress(null)
      setUploading(false)
    }
  }

  const resetForResubmission = (): void => {
    clearIdempotencyKey("evidence", account.subjectKey, goal.id)
    setCaptureClosed(false)
    setChallenge(null)
    setChallengeExpired(false)
    status.clear()
    setMessage(null)
    setPhoto(null)
    setTransportRetry(false)
    setUploadContinuation(null)
    setUploadProgress(null)
  }

  const submissionOpen = goal.state === "evidence_open" && !captureClosed
  return {
    actions: {
      abortUpload: () => {
        cancelRequestedRef.current = true
        abortRef.current?.abort()
      },
      beginChallenge,
      refreshStatus: status.refresh,
      resetForResubmission,
      selectPhoto,
      setCameraMessage: (text: string | null) =>
        setMessage(text === null ? null : { kind: "error", text }),
      setConsent,
      submitPhoto,
    },
    state: {
      activeChallenge:
        submissionOpen && challenge !== null && !challengeExpired && remainingSeconds > 0,
      challenge,
      challengeExpired,
      consent,
      evidence: status.evidence,
      message: message ?? status.message,
      online,
      photo,
      preparing,
      receiptId: status.receiptId,
      remainingSeconds,
      statusBusy: status.statusBusy,
      submissionOpen,
      transportRetry,
      uploadProgress,
      uploading,
    },
  }
}
