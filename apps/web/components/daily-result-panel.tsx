import type { DailyResult, Goal, ReputationEvent } from "../lib/contracts"
import { Notice } from "./notice"
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
      return { heading: "오늘 목표가 완료되었어요", label: "서버 결과 · 완료", state: "ready" }
    case "failed":
      return {
        heading: "오늘 목표가 미완료로 끝났어요",
        label: "서버 결과 · 미완료",
        state: "error",
      }
    case "expired":
      return {
        heading: "오늘 목표의 기한이 끝났어요",
        label: "서버 결과 · 기한 종료",
        state: "pending",
      }
    case "cancelled":
      return {
        heading: "오늘 목표가 취소되었어요",
        label: "서버 결과 · 취소",
        state: "pending",
      }
    default: {
      const exhaustive: never = state
      throw new TypeError(`unexpected result state: ${String(exhaustive)}`)
    }
  }
}

function stateName(state: DailyResult["effectiveState"]): string {
  switch (state) {
    case "completed":
      return "완료"
    case "failed":
      return "미완료"
    case "expired":
      return "기한 종료"
    case "cancelled":
      return "취소"
    default: {
      const exhaustive: never = state
      throw new TypeError(`unexpected result state: ${String(exhaustive)}`)
    }
  }
}

function pointsLabel(points: number): string {
  return `${points > 0 ? "+" : ""}${points}점`
}

function eventLabel(event: ReputationEvent): string {
  switch (event.kind) {
    case "completion":
      return `완료 평판 ${pointsLabel(event.points)}`
    case "crowd":
      return `NO 다수에서 완료한 평판 ${pointsLabel(event.points)}`
    case "correction":
      return `운영자 교정 ${pointsLabel(event.points)}`
    default: {
      const exhaustive: never = event
      throw new TypeError(`unexpected reputation event: ${JSON.stringify(exhaustive)}`)
    }
  }
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
  const latestCorrection = result.reputationEvents.findLast(
    (event): event is Extract<ReputationEvent, { readonly kind: "correction" }> =>
      event.kind === "correction",
  )

  return (
    <StatusPanel
      action={
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
      }
      heading={historical ? "이전 결과와 평판 기록" : presentation.heading}
      state={{ kind: presentation.state, label: presentation.label }}
    >
      <p className="resultDate">{result.goal.localGoalDate} 서버 기록이에요.</p>
      <p>
        NO {result.crowd.no}표 · YES {result.crowd.yes}표 · 총{" "}
        {result.crowd.no + result.crowd.yes}표
      </p>
      {latestCorrection === undefined ? null : (
        <Notice announce kind="info">
          운영자 교정으로 {stateName(latestCorrection.correctedState)} 상태가 적용되었어요.
        </Notice>
      )}
      <ul className="resultEventList">
        {result.reputationEvents.length === 0 ? (
          <li>적립되거나 교정된 평판 이벤트가 없어요.</li>
        ) : (
          result.reputationEvents.map((event) => (
            <li key={event.eventKey}>{eventLabel(event)}</li>
          ))
        )}
      </ul>
      <p className="resultTotal">현재 파생 평판 {result.reputationTotal}점</p>
      <p className="formHelper">비환전·비양도 파생 평판이며 돈이나 교환 자산이 아니에요.</p>
    </StatusPanel>
  )
}
