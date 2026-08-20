import type { DailyResult, Goal } from "../lib/contracts"
import { StatusPanel } from "./status-panel"

type DailyResultPanelProps = {
  readonly busy: boolean
  readonly currentGoal: Goal | null
  readonly online: boolean
  readonly onRefresh: () => void
  readonly result: DailyResult
}

type ResultPresentation = {
  readonly heading: string
  readonly label: string
  readonly state: "error" | "pending" | "ready"
}

function resultPresentation(state: DailyResult["effectiveState"]): ResultPresentation {
  switch (state) {
    case "completed":
      return { heading: "오늘 루틴을 완료했어요", label: "완료", state: "ready" }
    case "failed":
      return {
        heading: "오늘 루틴을 마치지 못했어요",
        label: "미완료",
        state: "error",
      }
    case "expired":
      return {
        heading: "오늘 루틴의 시간이 끝났어요",
        label: "시간 종료",
        state: "pending",
      }
    case "cancelled":
      return {
        heading: "오늘 루틴을 취소했어요",
        label: "취소",
        state: "pending",
      }
    default: {
      const exhaustive: never = state
      throw new TypeError(`unexpected result state: ${String(exhaustive)}`)
    }
  }
}

function pointsLabel(points: number): string {
  return `${points > 0 ? "+" : ""}${points}점`
}

export function DailyResultPanel({
  busy,
  currentGoal,
  online,
  onRefresh,
  result,
}: DailyResultPanelProps) {
  const presentation = resultPresentation(result.effectiveState)
  const historical = currentGoal?.id !== result.goal.id
  const earnedPoints = result.reputationEvents.reduce((total, event) => total + event.points, 0)

  return (
    <StatusPanel
      action={
        result.effectiveState === "completed" ? null : (
          <button
            aria-busy={busy}
            className="buttonQuiet"
            disabled={busy || !online}
            onClick={onRefresh}
            type="button"
          >
            {busy
              ? "오늘 상태 확인 중"
              : online
                ? "오늘 상태 새로고침"
                : "연결 후 오늘 상태 새로고침"}
          </button>
        )
      }
      className="dailyResultPanel"
      heading={historical ? "이전 루틴 기록" : presentation.heading}
      state={{ kind: presentation.state, label: presentation.label }}
    >
      <p className="resultTask">
        25분 학습하고 노트 {result.goal.fields.noteLineTarget}줄을 남겼어요.
      </p>
      <div className="resultSummary">
        <p>
          평판 <strong>{pointsLabel(earnedPoints)}</strong>
        </p>
        <p>
          다른 사람의 예상{" "}
          <strong>
            불가능 {result.crowd.no} · 가능 {result.crowd.yes}
          </strong>
        </p>
      </div>
      <p className="formHelper">
        누적 평판 {result.reputationTotal}점 · 현금처럼 사용할 수 없어요.
      </p>
    </StatusPanel>
  )
}
