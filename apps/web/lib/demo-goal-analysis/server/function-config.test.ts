import { afterEach, describe, expect, it, vi } from "vitest"
import { config, handler } from "../../../netlify/functions/demo-goal-analysis.mjs"
import { GOAL_ANALYSIS_RATE_LIMIT, GOAL_ANALYSIS_RATE_WINDOW_MS } from "./rate-limit"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("Netlify goal-analysis function config", () => {
  it("exports the same-origin route and code-based per-domain-and-IP limit", () => {
    // Given
    const expectedWindowSeconds = GOAL_ANALYSIS_RATE_WINDOW_MS / 1_000

    // When
    const exportedConfig = config

    // Then
    expect(exportedConfig).toEqual({
      path: "/api/demo/goal-analysis",
      rateLimit: {
        aggregateBy: ["ip", "domain"],
        windowLimit: GOAL_ANALYSIS_RATE_LIMIT,
        windowSize: expectedWindowSeconds,
      },
    })
  })

  it("dispatches the Netlify handler through the Gemini 3.5 Flash-Lite endpoint", async () => {
    // Given
    let capturedUrl = ""
    vi.stubEnv("GEMINI_API_KEY", "test-only-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request): Promise<Response> => {
        capturedUrl = input instanceof Request ? input.url : input.toString()
        return Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      probability: 64,
                      confidence: "medium",
                      factors: ["구체적인 목표예요"],
                    }),
                  },
                ],
              },
            },
          ],
        })
      }),
    )
    const request = new Request("https://routine.example/api/demo/goal-analysis", {
      body: JSON.stringify({ goals: ["매일 10분 걷기"] }),
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
      method: "POST",
    })

    // When
    const response = await handler(request)

    // Then
    expect(capturedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ source: "gemini" })
  })
})
