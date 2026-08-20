import { resolve } from "node:path"
import { loadEnvFile } from "node:process"
import type { EvidenceObjectStore } from "@polyroutine/contracts"
import { createDatabase } from "@polyroutine/db"
import type { TestPostgres } from "@polyroutine/testing"
import { startTestPostgres } from "@polyroutine/testing"
import type { FastifyInstance } from "fastify"
import { request } from "undici"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createServer } from "../src/app.js"
import { parseConfig } from "../src/config.js"

const evidenceObjectStore: EvidenceObjectStore = {
  delete: async () => undefined,
  put: async () => undefined,
}
describe("health integration", () => {
  let address = ""
  let database: ReturnType<typeof createDatabase> | undefined
  let postgres: TestPostgres | undefined
  let server: FastifyInstance | undefined

  beforeAll(async () => {
    loadEnvFile(resolve(import.meta.dirname, "../../../.env.test"))
    postgres = await startTestPostgres()
    const config = parseConfig({ ...process.env, DATABASE_URL: postgres.connectionString })
    database = createDatabase(config.DATABASE_URL)
    server = createServer({
      clock: { now: () => new Date("2026-08-19T00:00:00.000Z") },
      database,
      evidenceObjectStore,
      uuid: { create: () => "00000000-0000-4000-8000-000000000001" },
    })
    address = await server.listen({ host: "127.0.0.1", port: 0 })
  }, 120_000)

  afterAll(async () => {
    if (server !== undefined) await server.close()
    if (database !== undefined) await database.destroy()
    if (postgres !== undefined) await postgres.container.stop()
  })

  it("returns 200 from /health/live when the process is serving", async () => {
    // Given
    const url = `${address}/health/live`

    // When
    const response = await request(url)
    await response.body.text()

    // Then
    expect(response.statusCode).toBe(200)
  })

  it("returns 200 from /health/ready when PostgreSQL is reachable", async () => {
    // Given
    const url = `${address}/health/ready`

    // When
    const response = await request(url)
    await response.body.text()

    // Then
    expect(response.statusCode).toBe(200)
  })
})
