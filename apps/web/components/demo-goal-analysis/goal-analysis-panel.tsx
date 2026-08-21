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
        <div>
          <span className={styles["eyebrow"]}>AI 예상 성공 확률</span>
          <strong className={styles["probability"]}>{model.probability}%</strong>
        </div>
        <div className={styles["metadata"]}>
          <span>{model.label}</span>
          <span>신뢰도 {model.confidence}</span>
        </div>
      </div>
      <p className={styles["separation"]}>참여자 예측 비율과 별도로 제공하는 참고값이에요.</p>
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
      {isLoading ? (
        <div aria-live="polite" className={styles["progress"]} role="status">
          <strong>AI가 목표를 분석하고 있어요</strong>
          <span>구체성 · 분량 · 실행 기준을 살펴봐요</span>
        </div>
      ) : null}
      {result === undefined ? null : <GoalAnalysisResultView result={result} />}
      {state.kind === "fallback" ? (
        <p className={styles["fallbackNotice"]} role="status">
          AI 분석 대신 데모 계산을 보여드렸어요. 다시 시도할 수 있어요.
        </p>
      ) : null}
      {state.kind === "invalid_input" ? (
        <p className={styles["inputError"]} role="alert">
          목표를 1개 이상 입력해 주세요.
        </p>
      ) : null}
      <div className={styles["actionGroup"]}>
        <p className={styles["privacyWarning"]}>
          목표가 Google로 전송돼요. 민감한 정보는 제외해 주세요.
        </p>
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
            {isLoading ? <LoadingDots /> : null}
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
    <span aria-label="목표 분석 중" className={styles["loadingDots"]} role="status">
      <i />
      <i />
      <i />
    </span>
  )
}
