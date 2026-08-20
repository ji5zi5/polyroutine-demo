import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { GoalAnalysisRequestSchema, GoalAnalysisResultSchema } from "./contract"
import { analyzeGoalsFallback } from "./fallback"

const evidencePath = fileURLToPath(
  new URL(
    "../../../../.omo/evidence/polyroutine-demo-next-iteration/task-02-ai-cases.json",
    import.meta.url,
  ),
)

describe("five-goal Korean contract and fallback probe", () => {
  it("emits independently checked request and result evidence", () => {
    // Given
    const rawRequest = {
      goals: [
        "매일 30분 운동하기",
        "책 10쪽 읽기",
        "영어 단어 20개 복습하기",
        "물 2잔 마시기",
        "감사일기 3줄 기록하기",
      ],
    }
    const parsedRequest = GoalAnalysisRequestSchema.parse(rawRequest)

    // When
    const output = analyzeGoalsFallback(parsedRequest)
    const replay = analyzeGoalsFallback(parsedRequest)
    const varied = analyzeGoalsFallback(
      GoalAnalysisRequestSchema.parse({ goals: ["주말에 산책하기"] }),
    )
    const report = {
      parsedRequest,
      output: {
        probability: output.probability,
        confidence: output.confidence,
        factorCount: output.factors.length,
        factors: output.factors,
        source: output.source,
      },
      independentConstraints: {
        requestAccepted: parsedRequest.goals.length === 5,
        resultSchemaAccepted: GoalAnalysisResultSchema.safeParse(output).success,
        probabilityInteger: Number.isInteger(output.probability),
        probabilityInRange: output.probability >= 0 && output.probability <= 100,
        confidenceAllowed: ["low", "medium", "high"].includes(output.confidence),
        factorCountInRange: output.factors.length >= 1 && output.factors.length <= 3,
        factorsWithin60Characters: output.factors.every((factor) => factor.length <= 60),
        sourceIsFallback: output.source === "fallback",
        deterministicReplay: JSON.stringify(replay) === JSON.stringify(output),
        variedForDifferentInput: JSON.stringify(varied) !== JSON.stringify(output),
      },
    }

    // Then
    expect(Object.values(report.independentConstraints).every(Boolean)).toBe(true)
    mkdirSync(dirname(evidencePath), { recursive: true })
    writeFileSync(evidencePath, `${JSON.stringify(report, undefined, 2)}\n`, "utf8")
    console.log("TASK_02_AI_CASES", JSON.stringify(report))
  })
})
