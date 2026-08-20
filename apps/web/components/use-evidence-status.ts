"use client"

import { useEffect, useState } from "react"
import { ApiClientError, ApiNetworkError, getEvidenceStatus } from "../lib/api"
import type { Account, EvidenceStatus, Goal } from "../lib/contracts"

type StatusMessage = {
  readonly kind: "error"
  readonly text: string
}

export function useEvidenceStatus(account: Account, goal: Goal, online: boolean) {
  const [evidence, setEvidence] = useState<EvidenceStatus | null>(null)
  const [message, setMessage] = useState<StatusMessage | null>(null)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)

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
          if (active) setMessage({ kind: "error", text: "기존 증거 상태를 불러오지 못했어요." })
          return
        }
        throw error
      })
    return () => {
      active = false
    }
  }, [account.subjectKey, goal.id, goal.state, online])

  const refresh = async (): Promise<void> => {
    setStatusBusy(true)
    setMessage(null)
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
          text: "검토 상태를 확인하지 못했어요. 나중에 다시 확인해 주세요.",
        })
        return
      }
      throw error
    } finally {
      setStatusBusy(false)
    }
  }

  return {
    acceptReceipt: (nextReceiptId: string): void => {
      setReceiptId(nextReceiptId)
      setEvidence(null)
      setMessage(null)
    },
    clear: (): void => {
      setEvidence(null)
      setMessage(null)
      setReceiptId(null)
    },
    clearMessage: (): void => setMessage(null),
    evidence,
    message,
    receiptId,
    refresh,
    statusBusy,
  }
}
