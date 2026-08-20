"use client"

import { useEffect, useRef, useState } from "react"
import {
  ApiClientError,
  ApiNetworkError,
  getEvidenceStatus,
  requestEvidenceChallenge,
} from "../lib/api"
import type { Account, EvidenceChallenge, EvidenceStatus, Goal } from "../lib/contracts"
import { sendEvidenceUpload } from "../lib/evidence-upload"
import { clearIdempotencyKey } from "../lib/session-storage"

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"])

export type LocalEvidencePhoto = {
  readonly file: File
  readonly previewUrl: string
}

type CaptureMessage = {
  readonly kind: "error" | "info"
  readonly text: string
}

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
  const [evidence, setEvidence] = useState<EvidenceStatus | null>(null)
  const [message, setMessage] = useState<CaptureMessage | null>(null)
  const [photo, setPhoto] = useState<LocalEvidencePhoto | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [statusBusy, setStatusBusy] = useState(false)
  const [transportRetry, setTransportRetry] = useState(false)
  const [uploading, setUploading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

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

  useEffect(() => {
    if (goal.state === "prediction_open" || !online) return
    let active = true
    void getEvidenceStatus(account.subjectKey, goal.id)
      .then((status) => {
        if (!active || status === null) return
        setEvidence(status)
        setReceiptId(status.receiptId)
      })
      .catch((error) => {
        if (error instanceof ApiClientError || error instanceof ApiNetworkError) {
          if (active) setMessage({ kind: "error", text: "기존 증거 상태를 불러오지 못했습니다." })
          return
        }
        throw error
      })
    return () => {
      active = false
    }
  }, [account.subjectKey, goal.id, goal.state, online])

  const beginChallenge = async (): Promise<void> => {
    if (!consent || !online || goal.state !== "evidence_open") return
    clearIdempotencyKey("evidence", account.subjectKey, goal.id)
    setPreparing(true)
    setMessage(null)
    setChallengeExpired(false)
    setPhoto(null)
    try {
      setChallenge(await requestEvidenceChallenge(account.subjectKey, goal.id))
    } catch (error) {
      if (error instanceof ApiNetworkError) {
        setMessage({ kind: "error", text: "서버 코드를 받지 못했습니다. 연결 후 다시 준비하세요." })
        return
      }
      if (error instanceof ApiClientError) {
        setMessage({ kind: "error", text: "지금은 새 증거 코드를 만들 수 없습니다." })
        return
      }
      throw error
    } finally {
      setPreparing(false)
    }
  }

  const selectPhoto = (file: File): void => {
    setMessage(null)
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
    setUploading(true)
    setMessage(null)
    setTransportRetry(false)
    try {
      const result = await sendEvidenceUpload(
        { account, challenge, file: photo.file, goal },
        controller.signal,
      )
      switch (result.kind) {
        case "receipt":
          setReceiptId(result.receiptId)
          setEvidence(null)
          setChallenge(null)
          setPhoto(null)
          return
        case "transport_unknown":
          setTransportRetry(true)
          setMessage({ kind: "error", text: result.message })
          return
        case "challenge_expired":
          setChallengeExpired(true)
          setPhoto(null)
          setMessage({ kind: "error", text: result.message })
          return
        case "closed":
          setCaptureClosed(true)
          setChallenge(null)
          setPhoto(null)
          setMessage({ kind: "error", text: result.message })
          return
        case "rejected":
          setMessage({ kind: "error", text: result.message })
          return
        default: {
          const unexpected: never = result
          throw new TypeError(`unexpected evidence upload result: ${JSON.stringify(unexpected)}`)
        }
      }
    } finally {
      abortRef.current = null
      setUploading(false)
    }
  }

  const refreshStatus = async (): Promise<void> => {
    setStatusBusy(true)
    try {
      const status = await getEvidenceStatus(account.subjectKey, goal.id)
      if (status !== null) {
        setEvidence(status)
        setReceiptId(status.receiptId)
      }
    } catch (error) {
      if (error instanceof ApiClientError || error instanceof ApiNetworkError) {
        setMessage({
          kind: "error",
          text: "검토 상태를 확인하지 못했습니다. 나중에 다시 확인하세요.",
        })
        return
      }
      throw error
    } finally {
      setStatusBusy(false)
    }
  }

  const resetForResubmission = (): void => {
    clearIdempotencyKey("evidence", account.subjectKey, goal.id)
    setCaptureClosed(false)
    setChallenge(null)
    setChallengeExpired(false)
    setEvidence(null)
    setMessage(null)
    setPhoto(null)
    setReceiptId(null)
  }

  const submissionOpen = goal.state === "evidence_open" && !captureClosed
  return {
    actions: {
      abortUpload: () => abortRef.current?.abort(),
      beginChallenge,
      refreshStatus,
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
      evidence,
      message,
      online,
      photo,
      preparing,
      receiptId,
      remainingSeconds,
      statusBusy,
      submissionOpen,
      transportRetry,
      uploading,
    },
  }
}
