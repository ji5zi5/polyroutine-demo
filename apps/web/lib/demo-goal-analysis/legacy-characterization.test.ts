import { describe, expect, it } from "vitest"

function calculateLegacySuccessProbability(goals: readonly string[]): number {
  const normalized = goals.join("\n").trim()
  if (normalized === "") return 0

  const taskCount = normalized.split(/\r?\n/).filter((task) => task.trim() !== "").length

  let textVariation = 0
  for (const character of normalized) {
    textVariation = (textVariation * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  }

  let score = 34 + Math.min(12, Math.floor(normalized.length * 0.8))
  if (/\d/.test(normalized)) score += 10
  if (/(분|시간|쪽|장|개|줄|회)/.test(normalized)) score += 8
  if (/(요약|기록|복습|완료|풀기|읽기|운동)/.test(normalized)) score += 7
  if (normalized.length >= 10 && normalized.length <= 30) score += 5
  score -= Math.max(0, taskCount - 1) * 4
  score += (textVariation % 9) - 4
  return Math.max(32, Math.min(89, score))
}

describe("calculateSuccessProbability characterization", () => {
  it("returns 75 when given the two-goal Korean demo case", () => {
    // Given
    const goals = ["매일 30분 운동", "책 10쪽 읽기"] as const

    // When
    const probability = calculateLegacySuccessProbability(goals)

    // Then
    expect(probability).toBe(75)
  })

  it("returns 66 when given the three-goal Korean demo case", () => {
    // Given
    const goals = ["물 2잔 마시기", "영어 단어 20개 복습", "감사일기 3줄 기록"] as const

    // When
    const probability = calculateLegacySuccessProbability(goals)

    // Then
    expect(probability).toBe(66)
  })
})
