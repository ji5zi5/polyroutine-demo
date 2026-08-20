import type { GoalAnalysisRequest, GoalAnalysisResult } from "./contract"

function confidenceFor(probability: number): GoalAnalysisResult["confidence"] {
  if (probability >= 75) return "high"
  if (probability >= 55) return "medium"
  return "low"
}

export function analyzeGoalsFallback(request: GoalAnalysisRequest): GoalAnalysisResult {
  const normalized = request.goals.join("\n").trim()
  const taskCount = normalized.split(/\r?\n/).filter((task) => task.trim() !== "").length

  let textVariation = 0
  for (const character of normalized) {
    textVariation = (textVariation * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  }

  let probability = 34 + Math.min(12, Math.floor(normalized.length * 0.8))
  if (/\d/.test(normalized)) probability += 10
  if (/(분|시간|쪽|장|개|줄|회)/.test(normalized)) probability += 8
  if (/(요약|기록|복습|완료|풀기|읽기|운동)/.test(normalized)) probability += 7
  if (normalized.length >= 10 && normalized.length <= 30) probability += 5
  probability -= Math.max(0, taskCount - 1) * 4
  probability += (textVariation % 9) - 4
  probability = Math.max(32, Math.min(89, probability))

  const factors = [
    /\d/.test(normalized) && /(분|시간|쪽|장|개|줄|회)/.test(normalized)
      ? "구체적인 수치와 단위가 있어 실행 기준이 선명해요"
      : undefined,
    /(요약|기록|복습|완료|풀기|읽기|운동)/.test(normalized)
      ? "확인할 수 있는 행동 표현이 포함되어 있어요"
      : undefined,
    taskCount === 1
      ? "한 가지 목표에 집중할 수 있어요"
      : `목표 ${taskCount}개를 함께 진행해 집중도가 분산될 수 있어요`,
  ].filter((factor): factor is string => factor !== undefined)

  return {
    probability,
    confidence: confidenceFor(probability),
    factors: factors.slice(0, 3),
    source: "fallback",
  }
}
