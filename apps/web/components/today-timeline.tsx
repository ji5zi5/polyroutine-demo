type TodayTimelineProps = {
  readonly goalCreated: boolean
  readonly predictionStarted: boolean
}

type TimelineStep = {
  readonly current: boolean
  readonly label: string
  readonly state: string
}

export function TodayTimeline({ goalCreated, predictionStarted }: TodayTimelineProps) {
  const steps: readonly TimelineStep[] = [
    {
      current: !goalCreated,
      label: "학습 목표",
      state: goalCreated ? "서버에 저장됨" : "지금 할 일",
    },
    {
      current: goalCreated && !predictionStarted,
      label: "익명 예측",
      state: predictionStarted ? "참여 중" : goalCreated ? "참여 가능" : "목표 뒤에 가능",
    },
    {
      current: goalCreated && predictionStarted,
      label: "증거 준비",
      state: goalCreated ? "마감 전에 준비" : "아직 열리지 않음",
    },
  ]

  return (
    <nav aria-label="오늘의 진행 순서" className="stack">
      <h2>오늘의 흐름</h2>
      <ol className="timelineList">
        {steps.map((step, index) => (
          <li
            aria-current={step.current ? "step" : undefined}
            className="timelineItem"
            key={step.label}
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
