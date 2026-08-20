import { describe, expect, it } from "vitest"
import type { GoalAnalysisOutcome } from "../contract"
import {
  createGoalAnalysisHandler,
  GOAL_ANALYSIS_BODY_LIMIT_BYTES,
  type GoalAnalyzer,
} from "./handler"

const validBody = JSON.stringify({ goals: ["매일 10분 걷기"] })

function createRequest(init: RequestInit = {}): Request {
  return new Request("https://routine.example/api/demo/goal-analysis", init)
}

function createHandler(
  outcome: GoalAnalysisOutcome = {
    ok: true,
    value: { probability: 72, confidence: "high", factors: ["구체적이에요"], source: "gemini" },
  },
) {
  const analyze: GoalAnalyzer = async () => outcome
  return createGoalAnalysisHandler({ analyze, consumeRateLimit: () => true })
}

describe("goal analysis HTTP handler", () => {
  it("returns 405 when the method is not POST", async () => {
    // Given
    const handler = createHandler()

    // When
    const response = await handler(createRequest({ method: "GET" }))

    // Then
    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("POST")
  })

  it("returns 415 when the media type is not JSON", async () => {
    // Given
    const handler = createHandler()

    // When
    const response = await handler(createRequest({ body: validBody, method: "POST" }))

    // Then
    expect(response.status).toBe(415)
  })

  it("returns 400 when JSON is malformed", async () => {
    // Given
    const handler = createHandler()

    // When
    const response = await handler(
      createRequest({
        body: "{broken",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    )

    // Then
    expect(response.status).toBe(400)
  })

  it("returns 400 when the Task-2 request schema rejects input", async () => {
    // Given
    const handler = createHandler()

    // When
    const response = await handler(
      createRequest({
        body: JSON.stringify({ goals: [] }),
        headers: { "content-type": "application/json; charset=utf-8" },
        method: "POST",
      }),
    )

    // Then
    expect(response.status).toBe(400)
  })

  it("returns 413 before analysis when the body exceeds its declared limit", async () => {
    // Given
    let analyzed = false
    const analyze: GoalAnalyzer = async () => {
      analyzed = true
      return { ok: false, error: { code: "provider_unavailable" } }
    }
    const handler = createGoalAnalysisHandler({ analyze, consumeRateLimit: () => true })

    // When
    const response = await handler(
      createRequest({
        body: "x".repeat(GOAL_ANALYSIS_BODY_LIMIT_BYTES + 1),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    )

    // Then
    expect(response.status).toBe(413)
    expect(analyzed).toBe(false)
  })

  it("returns a no-store structured result for a valid Korean request", async () => {
    // Given
    const handler = createHandler()

    // When
    const response = await handler(
      createRequest({
        body: validBody,
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
        method: "POST",
      }),
    )

    // Then
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      probability: 72,
      confidence: "high",
      factors: ["구체적이에요"],
      source: "gemini",
    })
  })

  it.each([
    ["missing_key", 503],
    ["rate_limited", 429],
    ["timeout", 504],
    ["invalid_schema", 502],
    ["provider_unavailable", 503],
  ] as const)("maps %s to HTTP %i without provider details", async (code, status) => {
    // Given
    const handler = createHandler({ ok: false, error: { code } })

    // When
    const response = await handler(
      createRequest({
        body: validBody,
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    )

    // Then
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ code })
  })

  it("returns 429 before analysis when the domain and IP limit is exhausted", async () => {
    // Given
    let analyzed = false
    const analyze: GoalAnalyzer = async () => {
      analyzed = true
      return { ok: false, error: { code: "provider_unavailable" } }
    }
    const handler = createGoalAnalysisHandler({ analyze, consumeRateLimit: () => false })

    // When
    const response = await handler(
      createRequest({
        body: validBody,
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    )

    // Then
    expect(response.status).toBe(429)
    expect(analyzed).toBe(false)
  })

  it("does not reuse a provider result across requests", async () => {
    // Given
    let probability = 40
    const analyze: GoalAnalyzer = async () => {
      probability += 1
      return {
        ok: true,
        value: { probability, confidence: "medium", factors: ["새 분석"], source: "gemini" },
      }
    }
    const handler = createGoalAnalysisHandler({ analyze, consumeRateLimit: () => true })
    const init = {
      body: validBody,
      headers: { "content-type": "application/json" },
      method: "POST",
    }

    // When
    const first = await handler(createRequest(init))
    const second = await handler(createRequest(init))

    // Then
    expect(await first.json()).toMatchObject({ probability: 41 })
    expect(await second.json()).toMatchObject({ probability: 42 })
  })

  it("converts unexpected analyzer errors to a generic typed response", async () => {
    // Given
    const analyze: GoalAnalyzer = async () => {
      throw new TypeError("sensitive infrastructure detail")
    }
    const handler = createGoalAnalysisHandler({ analyze, consumeRateLimit: () => true })

    // When
    const response = await handler(
      createRequest({
        body: validBody,
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    )

    // Then
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: "provider_unavailable" })
  })
})
