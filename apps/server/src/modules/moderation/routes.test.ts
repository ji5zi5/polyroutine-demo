import Fastify from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { registerModerationRoutes } from "./routes.js"

const apps: ReturnType<typeof Fastify>[] = []

describe("moderation HTTP boundary", () => {
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())))

  it("publishes the bounded UGC policy without authentication", async () => {
    const app = Fastify()
    apps.push(app)
    registerModerationRoutes(app, {
      policy: async () => ({
        adultSelfAttestationIsNotAgeVerification: true,
        evidenceAccess: "case_scoped_short_lived_operator_access",
        prohibitedContent: ["sexual_content", "violence", "personal_data", "malware"],
        retention: { pendingOrReportedHours: 168, terminalHours: 24, tombstoneDays: 90 },
      }),
    } as never)

    const response = await app.inject({ method: "GET", url: "/v1/safety/policy" })
    expect(response).toMatchObject({ statusCode: 200 })
    expect(response.json()).toMatchObject({
      adultSelfAttestationIsNotAgeVerification: true,
      retention: { pendingOrReportedHours: 168, terminalHours: 24, tombstoneDays: 90 },
    })
  })
})
