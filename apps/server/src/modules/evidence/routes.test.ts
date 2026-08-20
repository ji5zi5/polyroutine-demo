import { evidenceRecipeV1 } from "@polyroutine/contracts"
import Fastify from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { registerEvidenceRoutes } from "./routes.js"
import type { EvidenceService } from "./service.js"

const goalId = "00000000-0000-4000-8000-000000000001"

function createHarness() {
  const app = Fastify()
  let submitCalls = 0
  const service: EvidenceService = {
    challenge: async () => ({
      challengeId: "00000000-0000-4000-8000-000000000002",
      claim: evidenceRecipeV1.capture.claim,
      code: "PR-12345678",
      expiresAt: "2026-08-19T01:10:00.000Z",
      instructions: evidenceRecipeV1.instructions,
    }),
    submit: async () => {
      submitCalls += 1
      return { receiptId: "00000000-0000-4000-8000-000000000003", state: "pending" }
    },
  }
  registerEvidenceRoutes(app, service)
  return { app, submitCalls: () => submitCalls }
}

describe("evidence HTTP boundary", () => {
  const apps: ReturnType<typeof Fastify>[] = []

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
  })

  it("rejects unsupported media types and magic before ingest", async () => {
    // Given
    const unsupported = createHarness()
    const disguised = createHarness()
    apps.push(unsupported.app, disguised.app)

    // When
    const unsupportedResponse = await unsupported.app.inject({
      body: "GIF89a",
      headers: { "content-type": "image/gif", "x-subject-key": "owner" },
      method: "POST",
      url: `/v1/goals/${goalId}/evidence`,
    })
    const disguisedResponse = await disguised.app.inject({
      body: Buffer.from("MZ executable"),
      headers: { "content-type": "image/png", "x-subject-key": "owner" },
      method: "POST",
      url: `/v1/goals/${goalId}/evidence`,
    })

    // Then
    expect(unsupportedResponse).toMatchObject({ statusCode: 415 })
    expect(unsupportedResponse.json()).toEqual({ code: "IMAGE_TYPE_MISMATCH" })
    expect(disguisedResponse).toMatchObject({ statusCode: 415 })
    expect(disguisedResponse.json()).toEqual({ code: "IMAGE_TYPE_MISMATCH" })
    expect(unsupported.submitCalls() + disguised.submitCalls()).toBe(0)
  })

  it("rejects payloads over eight MiB before ingest", async () => {
    // Given
    const harness = createHarness()
    apps.push(harness.app)

    // When
    const response = await harness.app.inject({
      body: Buffer.alloc(8 * 1024 * 1024 + 1),
      headers: { "content-type": "image/png", "x-subject-key": "owner" },
      method: "POST",
      url: `/v1/goals/${goalId}/evidence`,
    })

    // Then
    expect(response).toMatchObject({ statusCode: 413 })
    expect(response.json()).toEqual({ code: "IMAGE_TOO_LARGE" })
    expect(harness.submitCalls()).toBe(0)
  })
})
