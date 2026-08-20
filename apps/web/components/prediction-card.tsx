"use client"

import { type PointerEvent, useRef } from "react"

export type PredictionChoice = "no" | "yes"

export type PredictionCardModel = {
  readonly anonymousAlias: string
  readonly evidenceDeadlineAt: string
  readonly goalId: string
  readonly predictionCutoffAt: string
  readonly recipe: {
    readonly id: "study_note_photo_v1"
    readonly instructions: string
    readonly version: 1
  }
}

type PredictionCardProps = {
  readonly busy: boolean
  readonly card: PredictionCardModel
  readonly onChoice: (choice: PredictionChoice) => void
}

const SWIPE_COMMIT_RATIO = 0.22

const serverTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
})

function formatServerTime(value: string): string {
  return `${serverTimeFormatter.format(new Date(value))} UTC`
}

function resetDrag(element: HTMLElement): void {
  element.setAttribute("data-dragging", "false")
  element.style.setProperty("--swipe-progress", "0")
  element.style.setProperty("--swipe-x", "0px")
}

export function PredictionCard({ busy, card, onChoice }: PredictionCardProps) {
  const startX = useRef<number | null>(null)
  const pointerId = useRef<number | null>(null)

  const handlePointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (busy || (event.target instanceof Element && event.target.closest("button") !== null)) return
    startX.current = event.clientX
    pointerId.current = event.pointerId
    event.currentTarget.setAttribute("data-dragging", "true")
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>): void => {
    if (startX.current === null || pointerId.current !== event.pointerId || busy) return
    const width = event.currentTarget.getBoundingClientRect().width
    const distance = Math.max(-width, Math.min(width, event.clientX - startX.current))
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    event.currentTarget.style.setProperty("--swipe-progress", String(distance / width))
    event.currentTarget.style.setProperty("--swipe-x", reduceMotion ? "0px" : `${distance}px`)
  }

  const handlePointerCancel = (event: PointerEvent<HTMLElement>): void => {
    startX.current = null
    pointerId.current = null
    resetDrag(event.currentTarget)
  }

  const handlePointerEnd = (event: PointerEvent<HTMLElement>): void => {
    if (startX.current === null || pointerId.current !== event.pointerId) return
    const distance = event.clientX - startX.current
    const threshold = event.currentTarget.getBoundingClientRect().width * SWIPE_COMMIT_RATIO
    startX.current = null
    pointerId.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resetDrag(event.currentTarget)
    if (Math.abs(distance) >= threshold) onChoice(distance > 0 ? "yes" : "no")
  }

  const descriptionId = `prediction-description-${card.goalId}`
  return (
    <article
      aria-describedby={descriptionId}
      aria-busy={busy}
      className="predictionCard"
      data-busy={busy}
      data-dragging="false"
      data-goal-id={card.goalId}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
    >
      <div className="cardMeta">
        <span className="aliasBadge">{card.anonymousAlias}</span>
        <span>카드 의견은 집계 전에 공개되지 않습니다</span>
      </div>
      <div className="stack">
        <p className="eyebrow">학습 노트 사진 · recipe v{card.recipe.version}</p>
        <h3>25분 학습 노트를 남길까요?</h3>
        <p id={descriptionId}>
          오늘 날짜, 서버 코드, 최소 3줄의 학습 노트를 한 장에 담는 목표입니다.
        </p>
      </div>
      <dl className="deadlineList">
        <div className="deadlineRow">
          <dt>서버 기준 예측 마감</dt>
          <dd>{formatServerTime(card.predictionCutoffAt)}</dd>
        </div>
        <div className="deadlineRow">
          <dt>서버 기준 증거 마감</dt>
          <dd>{formatServerTime(card.evidenceDeadlineAt)}</dd>
        </div>
      </dl>
      <p className="formHelper">
        이 선택은 익명 의견입니다. 사실 판정이 아니며, 도박이나 금전성 대가와 무관합니다.
      </p>
      <div className="choiceButtons">
        <button
          className="buttonChoice buttonNo"
          disabled={busy}
          onClick={() => onChoice("no")}
          type="button"
        >
          NO - 어려울 것 같아요
        </button>
        <button
          className="buttonChoice buttonYes"
          disabled={busy}
          onClick={() => onChoice("yes")}
          type="button"
        >
          YES - 해낼 것 같아요
        </button>
      </div>
    </article>
  )
}
