import { TimeoutError } from "ky"
import { describe, expect, it } from "vitest"
import { GoalAnalysisRequestSchema } from "../contract"
import {
  createGoalAnalysisClient,
  GOAL_ANALYSIS_ROUTE,
  type GoalAnalysisTransport,
  type GoalAnalysisTransportOptions,
} from "./goal-analysis-client"

type DeferredResponse = {
  readonly resolve: (value: unknown) => void
  readonly response: { json(): Promise<unknown> }
}

function deferredResponse(): DeferredResponse {
  let resolvePromise: ((value: unknown) => void) | undefined
  const promise = new Promise<unknown>((resolve) => {
    resolvePromise = resolve
  })
  if (resolvePromise === undefined) throw new TypeError("Deferred response was not initialized")
  return { resolve: resolvePromise, response: { json: () => promise } }
}

describe("goal analysis browser client", () => {
  it("posts the Task-2 request to the fixed same-origin route with a bounded timeout", async () => {
    // Given
    let capturedOptions: GoalAnalysisTransportOptions | undefined
    const transport: GoalAnalysisTransport = {
      post(route, options) {
        expect(route).toBe("/api/demo/goal-analysis")
        capturedOptions = options
        return {
          json: async () => ({
            confidence: "high",
            factors: ["구체적인 수치가 있어요"],
            probability: 73,
            source: "gemini",
          }),
        }
      },
    }
    const client = createGoalAnalysisClient(transport)
    const request = GoalAnalysisRequestSchema.parse({ goals: ["매일 10분 걷기"] })

    // When
    const result = await client.analyze(request)

    // Then
    expect(capturedOptions).toMatchObject({ json: request, retry: 0, timeout: 10_000 })
    expect(result).toMatchObject({ kind: "completed", label: "Gemini 분석" })
  })

  it("ignores an older response that arrives after the newer request", async () => {
    // Given
    const first = deferredResponse()
    const second = deferredResponse()
    const requests: GoalAnalysisTransportOptions[] = []
    const transport: GoalAnalysisTransport = {
      post(route, options) {
        expect(route).toBe(GOAL_ANALYSIS_ROUTE)
        requests.push(options)
        return requests.length === 1 ? first.response : second.response
      },
    }
    const client = createGoalAnalysisClient(transport)
    const firstPending = client.analyze(
      GoalAnalysisRequestSchema.parse({ goals: ["매일 10분 걷기"] }),
    )

    // When
    const secondPending = client.analyze(
      GoalAnalysisRequestSchema.parse({ goals: ["영어 단어 20개 복습"] }),
    )
    second.resolve({
      probability: 73,
      confidence: "high",
      factors: ["구체적이에요"],
      source: "gemini",
    })
    first.resolve({
      probability: 41,
      confidence: "low",
      factors: ["이전 응답이에요"],
      source: "gemini",
    })

    // Then
    expect(requests[0]?.signal.aborted).toBe(true)
    await expect(secondPending).resolves.toMatchObject({
      kind: "completed",
      value: { probability: 73 },
    })
    await expect(firstPending).resolves.toEqual({ kind: "cancelled" })
  })

  it("cancels the active request on reset or unmount cleanup", async () => {
    // Given
    const deferred = deferredResponse()
    let capturedSignal: AbortSignal | undefined
    const transport: GoalAnalysisTransport = {
      post(_route, options) {
        capturedSignal = options.signal
        return deferred.response
      },
    }
    const client = createGoalAnalysisClient(transport)
    const pending = client.analyze(GoalAnalysisRequestSchema.parse({ goals: ["책 10쪽 읽기"] }))

    // When
    client.cancel()
    deferred.resolve({
      probability: 82,
      confidence: "high",
      factors: ["늦은 응답이에요"],
      source: "gemini",
    })

    // Then
    expect(capturedSignal?.aborted).toBe(true)
    await expect(pending).resolves.toEqual({ kind: "cancelled" })
  })

  it("returns a deterministic labeled fallback when the endpoint is rate limited", async () => {
    // Given
    const transport: GoalAnalysisTransport = {
      post() {
        return { json: async () => ({ code: "rate_limited" }) }
      },
    }
    const client = createGoalAnalysisClient(transport)
    const request = GoalAnalysisRequestSchema.parse({ goals: ["매일 30분 운동", "책 10쪽 읽기"] })

    // When
    const first = await client.analyze(request)
    const second = await client.analyze(request)

    // Then
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      kind: "fallback",
      label: "데모 계산",
      value: { probability: 75, source: "fallback" },
    })
  })

  it.each([
    [
      "malformed response",
      async () => ({ probability: "73%", source: "gemini" }),
      "invalid_schema",
    ],
    [
      "network failure",
      async () => {
        throw new TypeError("offline")
      },
      "network",
    ],
    [
      "malformed JSON",
      async () => {
        throw new SyntaxError("Unexpected token")
      },
      "invalid_schema",
    ],
    [
      "10-second timeout",
      async () => {
        throw new TimeoutError(new Request("https://routine.example/api/demo/goal-analysis"))
      },
      "timeout",
    ],
  ] as const)("returns a retryable fallback for %s", async (_scenario, json, reason) => {
    // Given
    const transport: GoalAnalysisTransport = { post: () => ({ json }) }
    const client = createGoalAnalysisClient(transport)
    const request = GoalAnalysisRequestSchema.parse({ goals: ["매일 10분 걷기"] })

    // When
    const result = await client.analyze(request)

    // Then
    expect(result).toMatchObject({ kind: "fallback", label: "데모 계산", reason })
  })

  it("keeps only the last request active across rapid analyze and cancel interruptions", async () => {
    // Given
    const deferred = [deferredResponse(), deferredResponse(), deferredResponse()]
    const signals: AbortSignal[] = []
    const transport: GoalAnalysisTransport = {
      post(_route, options) {
        const response = deferred[signals.length]
        if (response === undefined) throw new RangeError("Unexpected request count")
        signals.push(options.signal)
        return response.response
      },
    }
    const client = createGoalAnalysisClient(transport)
    const request = GoalAnalysisRequestSchema.parse({ goals: ["매일 10분 걷기"] })

    // When
    const first = client.analyze(request)
    client.cancel()
    const second = client.analyze(request)
    const third = client.analyze(request)
    deferred[0]?.resolve({ probability: 10 })
    deferred[1]?.resolve({ probability: 20 })
    deferred[2]?.resolve({
      probability: 73,
      confidence: "high",
      factors: ["구체적이에요"],
      source: "gemini",
    })

    // Then
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true, false])
    await expect(first).resolves.toEqual({ kind: "cancelled" })
    await expect(second).resolves.toEqual({ kind: "cancelled" })
    await expect(third).resolves.toMatchObject({ kind: "completed", value: { probability: 73 } })
  })
})
