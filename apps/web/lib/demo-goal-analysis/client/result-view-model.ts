import type { GoalAnalysisState } from "./use-goal-analysis"

export type GoalAnalysisResultState = Extract<
  GoalAnalysisState,
  { readonly kind: "fallback" | "success" }
>

export type GoalAnalysisResultViewModel = {
  readonly factors: readonly string[]
  readonly probability: number
  readonly source: "fallback" | "gemini"
}

export function toGoalAnalysisResultViewModel(
  result: GoalAnalysisResultState,
): GoalAnalysisResultViewModel {
  return {
    factors: result.value.factors,
    probability: result.value.probability,
    source: result.value.source,
  }
}
