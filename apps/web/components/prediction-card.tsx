"use client"

import type { KeyboardEvent, PointerEvent } from "react"
import { useCallback, useEffect, useRef, useState } from "react"

export type PredictionChoice = "no" | "yes"

export type PredictionCardModel = {
  readonly aiPercent?: number
  readonly anonymousAlias: string
  readonly evidenceDeadlineAt: string
  readonly goalId: string
  readonly predictionCutoffAt: string
  readonly recipe: {
    readonly id: "study_note_photo_v1"
    readonly instructions: string
    readonly version: 1
  }
  readonly tasks?: readonly string[]
  readonly yesPercent?: number
}

type PredictionCardProps = {
  readonly busy: boolean
  readonly card: PredictionCardModel
  readonly nextCard?: PredictionCardModel
  readonly onChoice: (choice: PredictionChoice) => void
  readonly onSkip?: () => void
  readonly rewardEligible?: boolean
}

const SWIPE_COMMIT_MS = 320
const SWIPE_HINT_PX = 24
const SWIPE_THRESHOLD_PX = 64

function PredictionGoalContent({ card }: { readonly card: PredictionCardModel }) {
  if (card.tasks === undefined || card.tasks.length < 2) {
    return <h3>{card.recipe.instructions}</h3>
  }

  return (
    <div className="predictionGoalBundle">
      <h3>오늘 목표 {card.tasks.length}개</h3>
      <ul aria-label="묶음 목표">
        {card.tasks.map((task) => (
          <li key={task}>{task}</li>
        ))}
      </ul>
    </div>
  )
}

export function PredictionCard({
  busy,
  card,
  nextCard = card,
  onChoice,
  onSkip,
  rewardEligible = false,
}: PredictionCardProps) {
  const cardRef = useRef<HTMLButtonElement>(null)
  const pointerIdRef = useRef<number | null>(null)
  const pointerOriginRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const [committing, setCommitting] = useState(false)
  const locked = busy || committing
  const yesPercent = card.yesPercent ?? 50
  const yesPayout = Math.ceil(10_000 / yesPercent)
  const noPayout = Math.ceil(10_000 / (100 - yesPercent))

  const positionCard = useCallback((distance: number): void => {
    const node = cardRef.current
    if (node === null) return
    const rotation = Math.max(-8, Math.min(8, distance / 24))
    node.style.setProperty("--swipe-x", `${distance}px`)
    node.style.setProperty("--swipe-rotation", `${rotation}deg`)
    node.setAttribute(
      "data-swipe",
      distance >= SWIPE_HINT_PX ? "no" : distance <= -SWIPE_HINT_PX ? "yes" : "idle",
    )
  }, [])

  const resetCard = useCallback((): void => {
    const node = cardRef.current
    if (node === null) return
    node.style.setProperty("--swipe-x", "0px")
    node.style.setProperty("--swipe-rotation", "0deg")
    node.setAttribute("data-committing", "false")
    node.setAttribute("data-dragging", "false")
    node.setAttribute("data-swipe", "idle")
  }, [])

  const commitChoice = useCallback(
    (choice: PredictionChoice): void => {
      if (locked) return
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      if (reduceMotion) {
        onChoice(choice)
        return
      }
      setCommitting(true)
      cardRef.current?.setAttribute("data-committing", "true")
      const direction = choice === "yes" ? -1 : 1
      positionCard(direction * window.innerWidth)
      timerRef.current = window.setTimeout(() => {
        onChoice(choice)
        resetCard()
        setCommitting(false)
        timerRef.current = null
      }, SWIPE_COMMIT_MS)
    },
    [locked, onChoice, positionCard, resetCard],
  )

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const releasePointer = (event: PointerEvent<HTMLElement>): void => {
    if (pointerIdRef.current !== event.pointerId || pointerOriginRef.current === null) return
    const distance = event.clientX - pointerOriginRef.current
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pointerIdRef.current = null
    pointerOriginRef.current = null
    event.currentTarget.setAttribute("data-dragging", "false")
    if (Math.abs(distance) >= SWIPE_THRESHOLD_PX) {
      commitChoice(distance > 0 ? "no" : "yes")
      return
    }
    resetCard()
  }

  const cancelPointer = (event: PointerEvent<HTMLElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return
    pointerIdRef.current = null
    pointerOriginRef.current = null
    resetCard()
  }

  const chooseWithKeyboard = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    commitChoice(event.key === "ArrowLeft" ? "yes" : "no")
  }

  return (
    <div className="predictionDeck">
      <div className="predictionCardStage">
        <article aria-hidden="true" className="predictionCardPreview">
          <span className="aliasBadge">{nextCard.anonymousAlias}</span>
          <div className="predictionCardBody">
            <PredictionGoalContent card={nextCard} />
          </div>
        </article>
        <button
          aria-busy={locked}
          className="predictionCard"
          data-busy={locked}
          data-committing="false"
          data-dragging="false"
          data-goal-id={card.goalId}
          data-swipe="idle"
          onKeyDown={chooseWithKeyboard}
          onPointerCancel={cancelPointer}
          onPointerDown={(event) => {
            if (locked) return
            pointerIdRef.current = event.pointerId
            pointerOriginRef.current = event.clientX
            event.currentTarget.setAttribute("data-dragging", "true")
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (pointerIdRef.current !== event.pointerId || pointerOriginRef.current === null)
              return
            positionCard(event.clientX - pointerOriginRef.current)
          }}
          onPointerUp={releasePointer}
          ref={cardRef}
          type="button"
        >
          <span aria-hidden="true" className="swipeStamp swipeStampNo">
            불가능
          </span>
          <span aria-hidden="true" className="swipeStamp swipeStampYes">
            가능
          </span>
          <div className="predictionSignals">
            <span className="aliasBadge">{card.anonymousAlias}</span>
            <span className="aiEstimate">AI 예상 {card.aiPercent ?? 50}%</span>
          </div>
          <div className="predictionCardBody">
            <PredictionGoalContent card={card} />
            <section aria-label="현재 예측 비율" className="marketConsensus">
              <span className="marketConsensusTitle">참여자 예측</span>
              <div className="marketBar" role="presentation">
                <span
                  aria-hidden="true"
                  className="marketBarYes"
                  style={{ inlineSize: `${yesPercent}%` }}
                />
                <span
                  aria-hidden="true"
                  className="marketBarNo"
                  style={{ inlineSize: `${100 - yesPercent}%` }}
                />
              </div>
              <div className="marketLabels">
                <strong>가능 {yesPercent}%</strong>
                <strong>불가능 {100 - yesPercent}%</strong>
              </div>
            </section>
          </div>
        </button>
      </div>
      <div className="predictionDecisionActions">
        <div aria-hidden="true" className="swipeGestureGuide">
          <span>← 가능 {rewardEligible ? `${yesPayout}P` : ""}</span>
          <span>불가능 {rewardEligible ? `${noPayout}P` : ""} →</span>
        </div>
        {onSkip === undefined ? null : (
          <button className="swipeSkip" disabled={locked} onClick={onSkip} type="button">
            건너뛰기
          </button>
        )}
      </div>
    </div>
  )
}
