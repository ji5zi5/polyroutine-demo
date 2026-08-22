import { describe, expect, it } from "vitest"
import type { GoalAnalysisOutcome } from "../contract"
import {
  createGoalAnalysisHandler,
  GOAL_ANALYSIS_BODY_LIMIT_BYTES,
  type GoalAnalyzer,
} from "./handler"

const endpoint = "https://routine.example/api/demo/goal-analysis"
const encoder = new TextEncoder()
const successOutcome: GoalAnalysisOutcome = {
  ok: true,
  value: { probability: 72, confidence: "high", factors: ["구체적이에요"], source: "gemini" },
}

type StreamingRequestInit = RequestInit & {
  readonly duplex: "half"
}

type StreamingBodyOptions = {
  readonly headers?: HeadersInit
  readonly neverSettleCancel?: boolean
  readonly rejectedCancel?: boolean
}

function createPaddedValidBody(byteLength: number): string {
  const body = JSON.stringify({ goals: ["매일 10분 걷기"] })
  return body + " ".repeat(byteLength - encoder.encode(body).byteLength)
}

function createOverflowChunks(body: Uint8Array): readonly Uint8Array[] {
  return [
    body.slice(0, GOAL_ANALYSIS_BODY_LIMIT_BYTES),
    body.slice(GOAL_ANALYSIS_BODY_LIMIT_BYTES),
    encoder.encode("never pull this"),
  ]
}

function createStreamingRequest(
  chunks: readonly Uint8Array[],
  options: StreamingBodyOptions = {},
): {
  readonly request: Request
  readonly getPulledChunkCount: () => number
  readonly wasCancelled: () => boolean
} {
  let pulledChunkCount = 0
  let wasCancelled = false
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[pulledChunkCount]
        if (chunk === undefined) {
          controller.close()
          return
        }
        pulledChunkCount += 1
        controller.enqueue(chunk)
      },
      cancel() {
        wasCancelled = true
        if (options.neverSettleCancel) return new Promise<void>(() => {})
        if (options.rejectedCancel)
          return Promise.reject(new TypeError("cancelled source rejected"))
        return undefined
      },
    },
    { highWaterMark: 0 },
  )

  const init: StreamingRequestInit = {
    body,
    headers: { "content-type": "application/json", ...options.headers },
    method: "POST",
    duplex: "half",
  }
  return {
    request: new Request(endpoint, init),
    getPulledChunkCount: () => pulledChunkCount,
    wasCancelled: () => wasCancelled,
  }
}

function createHandler(analyze: GoalAnalyzer = async () => successOutcome) {
  return createGoalAnalysisHandler({ analyze, consumeRateLimit: () => true })
}

describe("goal analysis HTTP handler streaming body limit", () => {
  it("accepts exactly 4096 encoded bytes without a Content-Length header", async () => {
    // Given
    const body = encoder.encode(createPaddedValidBody(GOAL_ANALYSIS_BODY_LIMIT_BYTES))
    const stream = createStreamingRequest([body])
    const handler = createHandler()

    // When
    const response = await handler(stream.request)

    // Then
    expect(response.status).toBe(200)
    expect(stream.wasCancelled()).toBe(false)
  })

  it("stops a chunked body at the 4097th byte before pulling its trailing chunk", async () => {
    // Given
    const oversizedBody = encoder.encode(createPaddedValidBody(GOAL_ANALYSIS_BODY_LIMIT_BYTES + 1))
    const stream = createStreamingRequest(createOverflowChunks(oversizedBody))
    const handler = createHandler()

    // When
    const response = await handler(stream.request)

    // Then
    expect(response.status).toBe(413)
    expect(stream.getPulledChunkCount()).toBe(2)
    expect(stream.wasCancelled()).toBe(true)
  })

  it("enforces the byte limit when Content-Length understates a chunked body", async () => {
    // Given
    const oversizedBody = encoder.encode(createPaddedValidBody(GOAL_ANALYSIS_BODY_LIMIT_BYTES + 1))
    const stream = createStreamingRequest(createOverflowChunks(oversizedBody), {
      headers: { "content-length": "1" },
    })
    const handler = createHandler()

    // When
    const response = await handler(stream.request)

    // Then
    expect(response.status).toBe(413)
    expect(stream.getPulledChunkCount()).toBe(2)
    expect(stream.wasCancelled()).toBe(true)
  })

  it("counts multibyte UTF-8 bytes rather than JavaScript string characters", async () => {
    // Given
    const body = JSON.stringify({ goals: ["가".repeat(1_362)] })
    const encodedBody = encoder.encode(body)
    const stream = createStreamingRequest([encodedBody])
    const handler = createHandler()

    // When
    const response = await handler(stream.request)

    // Then
    expect(body.length).toBeLessThan(GOAL_ANALYSIS_BODY_LIMIT_BYTES)
    expect(encodedBody.byteLength).toBeGreaterThan(GOAL_ANALYSIS_BODY_LIMIT_BYTES)
    expect(response.status).toBe(413)
  })

  it("returns 413 without waiting for a hung source cancellation", async () => {
    // Given
    const oversizedBody = encoder.encode(createPaddedValidBody(GOAL_ANALYSIS_BODY_LIMIT_BYTES + 1))
    const stream = createStreamingRequest(createOverflowChunks(oversizedBody), {
      neverSettleCancel: true,
    })
    const handler = createHandler()

    // When
    const response = await handler(stream.request)

    // Then
    expect(response.status).toBe(413)
    expect(stream.wasCancelled()).toBe(true)
  })

  it("observes a rejected cancellation without an unhandled rejection", async () => {
    // Given
    const unhandledRejections: unknown[] = []
    const captureUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason)
    }
    process.on("unhandledRejection", captureUnhandledRejection)
    const oversizedBody = encoder.encode(createPaddedValidBody(GOAL_ANALYSIS_BODY_LIMIT_BYTES + 1))
    const stream = createStreamingRequest(createOverflowChunks(oversizedBody), {
      rejectedCancel: true,
    })
    const handler = createHandler()

    try {
      // When
      const response = await handler(stream.request)
      await new Promise<void>((resolve) => setImmediate(resolve))

      // Then
      expect(response.status).toBe(413)
      expect(stream.wasCancelled()).toBe(true)
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off("unhandledRejection", captureUnhandledRejection)
    }
  })

  it("returns a generic no-store 400 for an interrupted request stream", async () => {
    // Given
    const interruption = new TypeError("interrupted request stream")
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(interruption)
      },
    })
    const init: StreamingRequestInit = {
      body,
      headers: { "content-type": "application/json" },
      method: "POST",
      duplex: "half",
    }
    const request = new Request(endpoint, init)
    const handler = createHandler()

    // When
    const response = await handler(request)

    // Then
    expect(response.status).toBe(400)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ code: "invalid_input" })
  })
})
