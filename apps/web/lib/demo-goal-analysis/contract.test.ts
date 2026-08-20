import { describe, expect, it } from "vitest"
import {
  GoalAnalysisErrorSchema,
  GoalAnalysisRequestSchema,
  GoalAnalysisResultSchema,
} from "./contract"

describe("GoalAnalysisRequestSchema", () => {
  it("trims and parses one to five unique goals", () => {
    // Given
    const input = { goals: ["  매일 30분 운동  ", "책 10쪽 읽기"] }

    // When
    const request = GoalAnalysisRequestSchema.parse(input)

    // Then
    expect(request).toEqual({ goals: ["매일 30분 운동", "책 10쪽 읽기"] })
  })

  it.each([
    ["blank", { goals: ["   "] }],
    ["duplicate after trimming", { goals: ["매일 운동", " 매일 운동 "] }],
    ["six goals", { goals: ["가", "나", "다", "라", "마", "바"] }],
    ["121-character item", { goals: ["가".repeat(121)] }],
    [
      "more than 600 total characters",
      { goals: Array.from({ length: 6 }, (_, index) => `${index}${"가".repeat(100)}`) },
    ],
  ])("rejects %s", (_caseName, input) => {
    // Given / When
    const parsed = GoalAnalysisRequestSchema.safeParse(input)

    // Then
    expect(parsed.success).toBe(false)
  })
})

describe("GoalAnalysisResultSchema", () => {
  it("parses the complete bounded result contract", () => {
    // Given
    const input = {
      probability: 75,
      confidence: "high",
      factors: ["구체적인 수치와 단위가 있어요"],
      source: "fallback",
    }

    // When
    const result = GoalAnalysisResultSchema.parse(input)

    // Then
    expect(result).toEqual(input)
  })

  it.each([
    [
      "noninteger probability",
      { probability: 50.5, confidence: "medium", factors: ["요인"], source: "gemini" },
    ],
    [
      "61-character factor",
      { probability: 50, confidence: "medium", factors: ["가".repeat(61)], source: "gemini" },
    ],
  ])("rejects %s", (_caseName, input) => {
    // Given / When
    const parsed = GoalAnalysisResultSchema.safeParse(input)

    // Then
    expect(parsed.success).toBe(false)
  })
})

describe("GoalAnalysisErrorSchema", () => {
  it.each([
    "missing_key",
    "rate_limited",
    "timeout",
    "invalid_input",
    "invalid_schema",
    "provider_unavailable",
  ])("parses the typed %s failure", (code) => {
    // Given / When
    const error = GoalAnalysisErrorSchema.parse({ code })

    // Then
    expect(error.code).toBe(code)
  })
})
