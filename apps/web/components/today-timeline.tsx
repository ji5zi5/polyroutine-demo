import type { Goal } from "../lib/contracts"

type TodayTimelineProps = {
  readonly goalState: Goal["state"] | null
  readonly priorResultAvailable: boolean
}

type TimelinePhase = "evidence" | "goal" | "prediction" | "result"

type TimelineStep = {
  readonly label: string
  readonly phase: TimelinePhase
  readonly state: string
}

type TimelineView = {
  readonly current: TimelinePhase
  readonly evidence: string
  readonly goal: string
  readonly prediction: string
  readonly result: string
}

function timelineView(goalState: Goal["state"] | null, priorResultAvailable: boolean): TimelineView {
  switch (goalState) {
    case null:
      return {
        current: "goal",
        evidence: "목표를 만든 뒤 열려요",
        goal: priorResultAvailable ? "새 목표를 만들 수 있어요" : "지금 만들 수 있어요",
        prediction: "목표를 만든 뒤 열려요",
        result: priorResultAvailable ? "이전 결과는 보관됐어요" : "결과를 기다려요",
      }
    case "prediction_open":
      return {
        current: "prediction",
        evidence: "예측 마감 뒤 열려요",
        goal: "서버에 저장됐어요",
        prediction: "익명 예측을 받고 있어요",
        result: "결과를 기다려요",
      }
    case "evidence_open":
      return {
        current: "evidence",
        evidence: "사진을 제출할 수 있어요",
        goal: "서버에 저장됐어요",
        prediction: "예측이 마감됐어요",
        result: "결과를 기다려요",
      }
    case "completed":
    case "failed":
    case "expired":
    case "cancelled":
      return {
        current: "result",
        evidence: "증거 단계가 끝났어요",
        goal: "서버에 저장됐어요",
        prediction: "예측이 마감됐어요",
        result: "서버 결과가 확정됐어요",
      }
    default: {
      const exhaustive: never = goalState
      throw new TypeError(`unexpected goal state: ${String(exhaustive)}`)
    }
  }
}

export function TodayTimeline({ goalState, priorResultAvailable }: TodayTimelineProps) {
  const view = timelineView(goalState, priorResultAvailable)
  const steps: readonly TimelineStep[] = [
    { label: "학습 목표", phase: "goal", state: view.goal },
    { label: "익명 예측", phase: "prediction", state: view.prediction },
    { label: "증거 제출", phase: "evidence", state: view.evidence },
    { label: "결과와 평판", phase: "result", state: view.result },
  ]

  return (
    <nav aria-label="오늘의 진행 순서" className="stack">
      <h2>오늘의 흐름</h2>
      <ol className="timelineList">
        {steps.map((step, index) => (
          <li
            aria-current={step.phase === view.current ? "step" : undefined}
            className="timelineItem"
            key={step.phase}
          >
            <span className="timelineIndex" aria-hidden="true">
              {index + 1}
            </span>
            <span className="stackCompact">
              <strong>{step.label}</strong>
              <span className="timelineState">{step.state}</span>
            </span>
          </li>
        ))}
      </ol>
    </nav>
  )
}
