"use client"

import { useCallback, useEffect, useState } from "react"
import { GoalAnalysisRequestSchema, type GoalAnalysisResult } from "../contract"
import {
  createGoalAnalysisClient,
  type GoalAnalysisClient,
  type GoalAnalysisFallbackReason,
} from "./goal-analysis-client"

export type GoalAnalysisState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "success"
      readonly label: "Gemini 분석"
      readonly value: GoalAnalysisResult
    }
  | {
      readonly kind: "fallback"
      readonly label: "데모 계산"
      readonly reason: GoalAnalysisFallbackReason
      readonly value: GoalAnalysisResult
    }
  | { readonly kind: "invalid_input" }

export type GoalAnalysisHook = {
  readonly analyze: (goals: unknown) => Promise<void>
  readonly reset: () => void
  readonly state: GoalAnalysisState
}

export function useGoalAnalysis(injectedClient?: GoalAnalysisClient): GoalAnalysisHook {
  const [client] = useState(() => injectedClient ?? createGoalAnalysisClient())
  const [state, setState] = useState<GoalAnalysisState>({ kind: "idle" })

  useEffect(() => () => client.cancel(), [client])

  const reset = useCallback((): void => {
    client.cancel()
    setState({ kind: "idle" })
  }, [client])

  const analyze = useCallback(
    async (goals: unknown): Promise<void> => {
      const parsed = GoalAnalysisRequestSchema.safeParse({ goals })
      if (!parsed.success) {
        client.cancel()
        setState({ kind: "invalid_input" })
        return
      }

      setState({ kind: "loading" })
      const result = await client.analyze(parsed.data)
      switch (result.kind) {
        case "cancelled":
          return
        case "completed":
          setState({ kind: "success", label: result.label, value: result.value })
          return
        case "fallback":
          setState({
            kind: "fallback",
            label: result.label,
            reason: result.reason,
            value: result.value,
          })
          return
      }
    },
    [client],
  )

  return { analyze, reset, state }
}
