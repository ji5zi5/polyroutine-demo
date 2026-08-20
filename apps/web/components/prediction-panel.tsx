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
    ? "연결이 끊겼어요. 연결한 뒤 카드 목록을 다시 확인해요."
    : "카드 목록을 불러오지 못했어요. 잠시 뒤 다시 확인해요."
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
          text: "카드는 표시했지만 노출 기록 연결이 늦어지고 있어요.",
        })
        return
      }
      throw error
    })
  }, [account.subjectKey, activeCard])

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
      setFeed((current) =>
        current === null
          ? current
          : { ...current, cards: current.cards.filter((card) => card.goalId !== vote.goalId) },
      )
      onConfirmed()
      setMessage({
        kind: "success",
        text: vote.choice === "yes" ? "가능으로 선택했어요." : "불가능으로 선택했어요.",
      })
    } catch (error) {
      if (error instanceof ApiNetworkError) {
        setMessage({
          kind: "error",
          text: "연결이 끊겼어요. 다시 연결되면 같은 선택으로 이어갈게요.",
        })
        return
      }
      if (error instanceof ApiClientError && error.status === 409 && error.replacement) {
        clearIdempotencyKey("vote", account.subjectKey, vote.goalId)
        setPendingVote(null)
        setFeed((current) =>
          current === null
            ? current
            : { ...current, cards: current.cards.filter((card) => card.goalId !== vote.goalId) },
        )
        setMessage({
          kind: "info",
          text: "이미 다른 요청에서 투표가 확정되어 다음 카드를 불러왔어요.",
        })
        return
      }
      if (error instanceof ApiClientError) {
        setMessage({
          kind: "error",
          text: "선택을 저장하지 못했어요. 카드를 새로 불러온 뒤 다시 골라 주세요.",
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
            {Math.min(confirmedCount, 5)}개 참여
          </p>
          <h2 id="prediction-heading">다른 사람 루틴</h2>
        </div>
        {feed !== null && activeCard === undefined ? (
          <button
            className="buttonQuiet"
            disabled={loading || !online}
            onClick={() => void refreshFeed()}
            type="button"
          >
            {loading ? "불러오는 중" : online ? "카드 다시 불러오기" : "연결 후 다시 불러오기"}
          </button>
        ) : null}
      </header>
      <progress
        aria-label="오늘 참여 진행"
        className="predictionProgress"
        max={5}
        value={Math.min(confirmedCount, 5)}
      />

      {online ? null : (
        <Notice announce kind="info">
          오프라인에서는 카드와 의견 상태를 바꾸지 않아요.
        </Notice>
      )}

      {message === null ? null : (
        <Notice announce kind={message.kind}>
          {message.text}
        </Notice>
      )}

      {loading && feed === null ? (
        <p className="formHelper">참여할 수 있는 새 루틴을 불러오고 있어요.</p>
      ) : null}
      {feed === null ? null : activeCard === undefined ? (
        <div className="predictionEmpty stackCompact">
          <h3>오늘 참여를 마쳤어요</h3>
          <p>새 루틴이 준비되면 다시 참여할 수 있어요.</p>
        </div>
      ) : (
        <PredictionCard
          busy={submitting || !online}
          card={activeCard}
          key={activeCard.goalId}
          onChoice={choose}
        />
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
