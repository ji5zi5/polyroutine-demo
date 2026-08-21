import type { GoalAnalysisState } from "./use-goal-analysis"

export type GoalAnalysisResultState = Extract<
  GoalAnalysisState,
  { readonly kind: "fallback" | "success" }
>

export type GoalAnalysisResultViewModel = {
  readonly confidence: string
  readonly factors: readonly string[]
  readonly label: "Gemini 분석" | "데모 계산"
  readonly probability: number
  readonly source: "fallback" | "gemini"
}

const confidenceLabel = {
  high: "높음",
  low: "낮음",
  medium: "보통",
} as const

export function toGoalAnalysisResultViewModel(
  result: GoalAnalysisResultState,
): GoalAnalysisResultViewModel {
  return {
    confidence: confidenceLabel[result.value.confidence],
    factors: result.value.factors,
    label: result.label,
    probability: result.value.probability,
    source: result.value.source,
  }
}
