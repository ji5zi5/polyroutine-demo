"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ApiClientError,
  ApiNetworkError,
  exposeCard,
  getPredictionFeed,
  submitPrediction,
} from "../lib/api"
import type { Account, PredictionFeed } from "../lib/contracts"
import { clearIdempotencyKey, getOrCreateIdempotencyKey } from "../lib/session-storage"
import { Notice } from "./notice"
import { PredictionCard, type PredictionChoice } from "./prediction-card"
import { ShortagePanel } from "./shortage-panel"

type Message = {
  readonly kind: "error" | "info" | "success"
  readonly text: string
}

type PendingVote = {
  readonly choice: PredictionChoice
  readonly goalId: string
  readonly idempotencyKey: string
}

type PredictionPanelProps = {
  readonly account: Account
  readonly confirmedCount: number
  readonly online: boolean
  readonly onConfirmed: () => void
}

function feedErrorMessage(error: ApiClientError | ApiNetworkError): string {
  return error instanceof ApiNetworkError
    ? "연결이 끊겼습니다. 카드 목록을 다시 확인해 주세요."
    : "카드 목록을 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요."
}

export function PredictionPanel({
  account,
  confirmedCount,
  online,
  onConfirmed,
}: PredictionPanelProps) {
  const [feed, setFeed] = useState<PredictionFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<Message | null>(null)
  const [pendingVote, setPendingVote] = useState<PendingVote | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const refreshFeed = useCallback(async (): Promise<void> => {
    if (!online) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setFeed(await getPredictionFeed(account.subjectKey))
    } catch (error) {
      if (error instanceof ApiClientError || error instanceof ApiNetworkError) {
        setMessage({ kind: "error", text: feedErrorMessage(error) })
        return
      }
      throw error
    } finally {
      setLoading(false)
    }
  }, [account.subjectKey, online])

  useEffect(() => {
    void refreshFeed()
  }, [refreshFeed])

  const activeCard = feed?.cards[0]
  useEffect(() => {
    if (activeCard === undefined) return
    const idempotencyKey = getOrCreateIdempotencyKey(
      "exposure",
      account.subjectKey,
      activeCard.goalId,
    )
    void exposeCard(account.subjectKey, activeCard.goalId, idempotencyKey).catch((error) => {
      if (error instanceof ApiClientError || error instanceof ApiNetworkError) {
        setMessage({
          kind: "error",
          text: "카드는 표시됐지만 노출 기록 연결이 지연되고 있습니다.",
        })
        return
      }
      throw error
    })
  }, [account.subjectKey, activeCard])

  const reloadAfterDecision = async (goalId: string): Promise<void> => {
    try {
      setFeed(await getPredictionFeed(account.subjectKey))
    } catch (error) {
      if (error instanceof ApiClientError || error instanceof ApiNetworkError) {
        setFeed((current) =>
          current === null
            ? current
            : { ...current, cards: current.cards.filter((card) => card.goalId !== goalId) },
        )
        return
      }
      throw error
    }
  }

  const submit = async (vote: PendingVote): Promise<void> => {
    if (!online) return
    setPendingVote(vote)
    setSubmitting(true)
    try {
      await submitPrediction({
        choice: vote.choice,
        goalId: vote.goalId,
        idempotencyKey: vote.idempotencyKey,
        subjectKey: account.subjectKey,
      })
      clearIdempotencyKey("vote", account.subjectKey, vote.goalId)
      setPendingVote(null)
      onConfirmed()
      await reloadAfterDecision(vote.goalId)
      setMessage({
        kind: "success",
        text: `${vote.choice.toUpperCase()}가 서버에 저장되었습니다.`,
      })
    } catch (error) {
      if (error instanceof ApiNetworkError) {
        setMessage({
          kind: "error",
          text: "연결이 끊겨 서버 확인을 마치지 못했습니다. 같은 요청으로 다시 확인하세요.",
        })
        return
      }
      if (error instanceof ApiClientError && error.status === 409 && error.replacement) {
        clearIdempotencyKey("vote", account.subjectKey, vote.goalId)
        setPendingVote(null)
        await reloadAfterDecision(vote.goalId)
        setMessage({
          kind: "info",
          text: "이미 다른 요청에서 투표가 확정되어 다음 카드를 불러왔어요.",
        })
        return
      }
      if (error instanceof ApiClientError) {
        setMessage({
          kind: "error",
          text: "서버가 투표를 확정하지 않았습니다. 카드 상태를 다시 확인해 주세요.",
        })
        return
      }
      throw error
    } finally {
      setSubmitting(false)
    }
  }

  const choose = (choice: PredictionChoice): void => {
    if (activeCard === undefined || submitting || !online) return
    void submit({
      choice,
      goalId: activeCard.goalId,
      idempotencyKey: getOrCreateIdempotencyKey("vote", account.subjectKey, activeCard.goalId),
    })
  }

  return (
    <section className="predictionSection stack" aria-labelledby="prediction-heading">
      <header className="sectionHeader">
        <div className="stackCompact">
          <p className="eyebrow" data-testid="prediction-progress">
            {Math.min(confirmedCount, 5)}/최대 5
          </p>
          <h2 id="prediction-heading">익명 예측</h2>
        </div>
        <button
          className="buttonQuiet"
          disabled={loading || !online}
          onClick={() => void refreshFeed()}
          type="button"
        >
          {loading ? "확인 중" : online ? "카드 새로고침" : "연결 후 카드 새로고침"}
        </button>
      </header>

      {online ? null : (
        <Notice announce kind="info">
          오프라인에서는 카드와 투표 상태를 변경하지 않습니다.
        </Notice>
      )}

      {message === null ? null : (
        <Notice announce kind={message.kind}>
          {message.text}
        </Notice>
      )}

      {loading && feed === null ? (
        <p className="formHelper">서버에서 참여 가능한 익명 목표를 확인하고 있습니다.</p>
      ) : null}
      {feed === null ? null : (
        <>
          <ShortagePanel shortage={feed.shortage} />
          {activeCard === undefined ? null : (
            <PredictionCard busy={submitting || !online} card={activeCard} onChoice={choose} />
          )}
        </>
      )}
      {pendingVote === null ? null : (
        <button
          className="buttonQuiet shortageRefresh"
          disabled={submitting || !online}
          onClick={() => void submit(pendingVote)}
          type="button"
        >
          같은 요청 다시 확인
        </button>
      )}
    </section>
  )
}
