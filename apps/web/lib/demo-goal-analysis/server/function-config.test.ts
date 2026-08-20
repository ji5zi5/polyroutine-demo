import { describe, expect, it } from "vitest"
import { config } from "../../../netlify/functions/demo-goal-analysis.mjs"
import { GOAL_ANALYSIS_RATE_LIMIT, GOAL_ANALYSIS_RATE_WINDOW_MS } from "./rate-limit"

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
})
