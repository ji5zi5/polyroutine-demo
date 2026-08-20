"use client"

import type { FormEvent } from "react"
import type { Goal } from "../lib/contracts"
import { FormField } from "./form-field"
import { Notice } from "./notice"

type GoalPanelProps = {
  readonly busy: boolean
  readonly error: string | null
  readonly goal: Goal | null
  readonly historicalGoal: Goal | null
  readonly online: boolean
  readonly onCreate: (noteLineTarget: number) => Promise<void>
}

const serverTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeStyle: "short",
  timeZone: "UTC",
})

function formatServerTime(value: string): string {
  return `오늘 ${serverTimeFormatter.format(new Date(value))}까지`
}

function stateLabel(state: Goal["state"]): string {
  switch (state) {
    case "prediction_open":
      return "익명 예측을 받는 중"
    case "evidence_open":
      return "증거 제출 가능"
    case "completed":
      return "완료"
    case "failed":
      return "미완료"
    case "expired":
      return "기한 종료"
    case "cancelled":
      return "취소됨"
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

export function GoalPanel({ busy, error, goal, historicalGoal, online, onCreate }: GoalPanelProps) {
  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    await onCreate(Number(values.get("noteLineTarget")))
  }

  return (
    <>
      {goal === null ? (
        <section className="surfacePanel goalPanel" aria-labelledby="goal-heading">
          <div className="stackCompact">
            <p className="eyebrow">오늘 하나만</p>
            <h2 id="goal-heading">오늘의 학습 약속</h2>
          </div>
          <p>한 가지 안내를 따라요. 25분 학습하고 당일 노트를 사진 한 장에 남겨요.</p>
          <form aria-busy={busy} className="stack" onSubmit={handleSubmit}>
            <FormField
              helper="최소 3줄, 최대 20줄"
              id="note-line-target"
              input={{
                defaultValue: 3,
                disabled: busy || !online,
                max: 20,
                min: 3,
                name: "noteLineTarget",
                required: true,
                type: "number",
              }}
              label="학습 노트 줄 수"
            />
            {error === null ? null : (
              <Notice announce kind="error">
                {error}
              </Notice>
            )}
            <button
              aria-busy={busy}
              className="buttonFull"
              disabled={busy || !online}
              type="submit"
            >
              {busy ? "서버 확인 중" : online ? "오늘 목표 만들기" : "연결 후 오늘 목표 만들기"}
            </button>
          </form>
        </section>
      ) : (
        <section className="surfacePanel goalPanel" aria-labelledby="goal-heading">
          <div className="stackCompact">
            <p className="statusLabel statusReady">{stateLabel(goal.state)}</p>
            <h2 id="goal-heading">25분 학습하고 노트 남기기</h2>
          </div>
          <p>
            25분 학습 후 오늘 날짜, 서버 코드, 학습 노트 {goal.fields.noteLineTarget}줄 이상을 한
            장에 담아요.
          </p>
          <dl className="deadlineList">
            <div className="deadlineRow">
              <dt>사진 인증</dt>
              <dd>{formatServerTime(goal.evidenceDeadlineAt)}</dd>
            </div>
          </dl>
        </section>
      )}
      {historicalGoal === null ? null : (
        <section className="surfacePanel historyPanel" aria-labelledby="history-heading">
          <div className="stackCompact">
            <p className="eyebrow">{historicalGoal.localGoalDate}</p>
            <h2 id="history-heading">이전 목표 기록</h2>
          </div>
          <p>
            25분 학습 후 오늘 날짜, 서버 코드, 학습 노트 {historicalGoal.fields.noteLineTarget}줄
            이상을 한 장에 담는 목표였어요.
          </p>
          <p className="formHelper">서버가 확인한 목표를 이 기기에 보관한 읽기 전용 기록이에요.</p>
        </section>
      )}
    </>
  )
}
