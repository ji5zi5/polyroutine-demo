"use client"

import { useEffect, useRef } from "react"
import type { GoalAnalysisClient } from "../../lib/demo-goal-analysis/client/goal-analysis-client"
import {
  type GoalAnalysisResultState,
  toGoalAnalysisResultViewModel,
} from "../../lib/demo-goal-analysis/client/result-view-model"
import type { GoalAnalysisState } from "../../lib/demo-goal-analysis/client/use-goal-analysis"
import { useGoalAnalysis } from "../../lib/demo-goal-analysis/client/use-goal-analysis"
import styles from "./goal-analysis-panel.module.css"

export type GoalAnalysisResultViewProps = {
  readonly result: GoalAnalysisResultState
}

export function GoalAnalysisResultView({ result }: GoalAnalysisResultViewProps) {
  const model = toGoalAnalysisResultViewModel(result)
  return (
    <section aria-label="AI 예상 성공 확률" className={styles["result"]} data-source={model.source}>
      <div className={styles["resultHeading"]}>
        <span className={styles["eyebrow"]}>AI 예상 성공 확률</span>
        <strong className={styles["probability"]}>{model.probability}%</strong>
      </div>
      <details className={styles["factors"]}>
        <summary>분석 근거 {model.factors.length}개 보기</summary>
        <ul>
          {model.factors.map((factor) => (
            <li key={factor}>{factor}</li>
          ))}
        </ul>
      </details>
    </section>
  )
}

export type GoalAnalysisPanelProps = {
  readonly client?: GoalAnalysisClient
  readonly goals: readonly string[]
  readonly onAnalysisStart?: (goals: readonly string[]) => void
  readonly onStateChange?: (state: GoalAnalysisState) => void
}

export function GoalAnalysisPanel({
  client,
  goals,
  onAnalysisStart,
  onStateChange,
}: GoalAnalysisPanelProps) {
  const { analyze, reset, state } = useGoalAnalysis(client)
  const goalsKey = goals.join("\u0000")
  const previousGoalsKey = useRef(goalsKey)
  const result = state.kind === "success" || state.kind === "fallback" ? state : undefined
  const isLoading = state.kind === "loading"

  useEffect(() => {
    if (previousGoalsKey.current === goalsKey) return
    previousGoalsKey.current = goalsKey
    reset()
  }, [goalsKey, reset])

  useEffect(() => onStateChange?.(state), [onStateChange, state])

  return (
    <section className={styles["panel"]}>
      {result === undefined ? null : <GoalAnalysisResultView result={result} />}
      {state.kind === "invalid_input" ? (
        <p className={styles["inputError"]} role="alert">
          목표를 1개 이상 입력해 주세요.
        </p>
      ) : null}
      <div className={styles["actionGroup"]}>
        <button
          aria-busy={isLoading}
          className={`${styles["action"]} ${result === undefined ? "" : styles["actionSecondary"]}`}
          data-state={state.kind}
          disabled={isLoading || goals.length === 0}
          onClick={() => {
            onAnalysisStart?.(goals)
            void analyze(goals)
          }}
          type="button"
        >
          <span className={styles["actionContent"]} key={state.kind}>
            {isLoading ? (
              <>
                <LoadingDots />
                목표 분석 중
              </>
            ) : null}
            {state.kind === "success" ? "다시 분석하기" : null}
            {state.kind === "fallback" ? "다시 분석하기" : null}
            {state.kind === "idle" || state.kind === "invalid_input" ? "성공 확률 분석하기" : null}
          </span>
        </button>
      </div>
    </section>
  )
}

function LoadingDots() {
  return (
    <span aria-hidden="true" className={styles["loadingDots"]}>
      <i />
      <i />
      <i />
    </span>
  )
}
