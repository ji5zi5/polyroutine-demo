import { describe, expect, it } from "vitest"
import { type GoalAnalysisResultState, toGoalAnalysisResultViewModel } from "./result-view-model"

describe("goal analysis result view model", () => {
  it.each([
    ["Gemini analysis", "success", "gemini", "Gemini 분석"],
    ["deterministic fallback", "fallback", "fallback", "데모 계산"],
  ] as const)(
    "keeps the source and visible label independent for %s",
    (_scenario, kind, source, label) => {
      // Given
      const result: GoalAnalysisResultState =
        kind === "success"
          ? {
              kind,
              label,
              value: { confidence: "high", factors: ["구체적이에요"], probability: 73, source },
            }
          : {
              kind,
              label,
              reason: "rate_limited",
              value: { confidence: "high", factors: ["구체적이에요"], probability: 73, source },
            }

      // When
      const model = toGoalAnalysisResultViewModel(result)

      // Then
      expect(model).toMatchObject({ label, probability: 73, source })
    },
  )

  it("keeps a prompt-injection factor as inert text data", () => {
    // Given
    const injection = "<img src=x onerror=\"window.location='https://evil.example'\">"
    const result: GoalAnalysisResultState = {
      kind: "success",
      label: "Gemini 분석",
      value: { confidence: "low", factors: [injection], probability: 12, source: "gemini" },
    }

    // When
    const model = toGoalAnalysisResultViewModel(result)

    // Then
    expect(model.factors).toEqual([injection])
    expect(Object.keys(model)).not.toContain("html")
  })
})
