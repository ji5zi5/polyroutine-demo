import { describe, expect, it } from "vitest"
import {
  createDomainIpRateLimiter,
  GOAL_ANALYSIS_RATE_LIMIT,
  GOAL_ANALYSIS_RATE_WINDOW_MS,
} from "./rate-limit"

function request(ip: string): Request {
  return new Request("https://routine.example/api/demo/goal-analysis", {
    headers: { "x-forwarded-for": ip },
  })
}

describe("domain and IP rate limiter", () => {
  it("allows five requests and rejects the sixth in one minute", () => {
    // Given
    const limiter = createDomainIpRateLimiter(() => 1_000)

    // When
    const results = Array.from({ length: GOAL_ANALYSIS_RATE_LIMIT + 1 }, () =>
      limiter.consume(request("203.0.113.7")),
    )

    // Then
    expect(results).toEqual([true, true, true, true, true, false])
  })

  it("isolates the budget by domain and IP", () => {
    // Given
    const limiter = createDomainIpRateLimiter(() => 1_000)
    for (let index = 0; index < GOAL_ANALYSIS_RATE_LIMIT; index += 1) {
      limiter.consume(request("203.0.113.7"))
    }

    // When
    const accepted = limiter.consume(request("203.0.113.8"))

    // Then
    expect(accepted).toBe(true)
  })

  it("starts a fresh budget after sixty seconds using injected time", () => {
    // Given
    let timestamp = 1_000
    const limiter = createDomainIpRateLimiter(() => timestamp)
    for (let index = 0; index < GOAL_ANALYSIS_RATE_LIMIT; index += 1) {
      limiter.consume(request("203.0.113.7"))
    }

    // When
    timestamp += GOAL_ANALYSIS_RATE_WINDOW_MS
    const accepted = limiter.consume(request("203.0.113.7"))

    // Then
    expect(accepted).toBe(true)
  })
})
