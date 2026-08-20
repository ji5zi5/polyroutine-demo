import { describe, expect, it } from "vitest"
import { GoalAnalysisRequestSchema, GoalAnalysisResultSchema } from "./contract"
import { analyzeGoalsFallback } from "./fallback"

describe("analyzeGoalsFallback", () => {
  it.each([
    [["매일 30분 운동", "책 10쪽 읽기"], 75],
    [["물 2잔 마시기", "영어 단어 20개 복습", "감사일기 3줄 기록"], 66],
  ] as const)(
    "preserves the legacy probability for Korean goals %#",
    (goals, expectedProbability) => {
      // Given
      const request = GoalAnalysisRequestSchema.parse({ goals })

      // When
      const result = analyzeGoalsFallback(request)

      // Then
      expect(result.probability).toBe(expectedProbability)
    },
  )

  it("returns a schema-valid fallback result", () => {
    // Given
    const request = GoalAnalysisRequestSchema.parse({ goals: ["매일 30분 운동", "책 10쪽 읽기"] })

    // When
    const result = analyzeGoalsFallback(request)

    // Then
    expect(GoalAnalysisResultSchema.safeParse(result).success).toBe(true)
    expect(result.source).toBe("fallback")
  })

  it("returns the same result for the same input without clock or randomness", () => {
    // Given
    const request = GoalAnalysisRequestSchema.parse({
      goals: ["매일 스트레칭 10분", "하루 기록 3줄"],
    })

    // When
    const first = analyzeGoalsFallback(request)
    const second = analyzeGoalsFallback(request)

    // Then
    expect(second).toEqual(first)
  })

  it("varies the analysis when goal content changes", () => {
    // Given
    const firstRequest = GoalAnalysisRequestSchema.parse({ goals: ["매일 스트레칭 10분"] })
    const secondRequest = GoalAnalysisRequestSchema.parse({ goals: ["주말에 산책하기"] })

    // When
    const first = analyzeGoalsFallback(firstRequest)
    const second = analyzeGoalsFallback(secondRequest)

    // Then
    expect(second).not.toEqual(first)
  })
})
