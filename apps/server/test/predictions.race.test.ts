import type { EvidenceObjectStore } from "@polyroutine/contracts"
import { createDatabase, migrateUp } from "@polyroutine/db"
import type { TestPostgres } from "@polyroutine/testing"
import { startTestPostgres } from "@polyroutine/testing"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createServer } from "../src/app.js"

const evidenceObjectStore: EvidenceObjectStore = {
  delete: async () => undefined,
  put: async () => undefined,
}
const goalId = "00000000-0000-4000-8000-000000000601"

function predictionRequest(
  server: FastifyInstance,
  index: number,
  idempotencyKey = `race-${index}`,
) {
  return server.inject({
    body: { choice: index % 2 === 0 ? "yes" : "no" },
    headers: { "idempotency-key": idempotencyKey, "x-subject-key": "predictor" },
    method: "POST",
    url: `/v1/predictions/${goalId}`,
  })
}

describe("atomic prediction insert races", () => {
  let database: ReturnType<typeof createDatabase> | undefined
  let postgres: TestPostgres | undefined
  let server: FastifyInstance | undefined

  beforeAll(async () => {
    const { TEST_DATABASE_URL } = process.env
    if (TEST_DATABASE_URL === undefined) {
      postgres = await startTestPostgres()
      database = createDatabase(postgres.connectionString)
    } else {
      database = createDatabase(TEST_DATABASE_URL)
    }
    await migrateUp(database)
    server = createServer({
      clock: { now: () => new Date("2026-08-19T09:00:00.000Z") },
      database,
      evidenceObjectStore,
      uuid: { create: () => crypto.randomUUID() },
    })
    await server.ready()
  }, 120_000)

  afterAll(async () => {
    if (server !== undefined) await server.close()
    if (database !== undefined) await database.destroy()
    if (postgres !== undefined) await postgres.container.stop()
  })

  beforeEach(async () => {
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    await handle.pool.query("truncate users cascade")
    await handle.pool.query(
      "insert into users(subject_key, timezone) values ('owner', 'UTC'), ('predictor', 'UTC')",
    )
    await handle.pool.query(
      `insert into goals(id, owner_subject_key, local_goal_date, recipe_id, recipe_version,
         goal_copy, prediction_cutoff_at, evidence_deadline_at)
       values ($1, 'owner', current_date, 'study_note_photo_v1', 1, '{}',
         clock_timestamp() + interval '1 hour', clock_timestamp() + interval '12 hours')`,
      [goalId],
    )
  })

  it("allows one effective immutable outcome from 100 concurrent YES/NO requests", async () => {
    // Given
    const app = server
    const handle = database
    if (app === undefined || handle === undefined) throw new TypeError("fixtures are unavailable")

    // When
    const responses = await Promise.all(
      Array.from({ length: 100 }, (_, index) => predictionRequest(app, index)),
    )

    // Then
    expect(responses.filter(({ statusCode }) => statusCode === 201)).toHaveLength(1)
    expect(
      responses.filter(({ statusCode }) => statusCode === 409),
      JSON.stringify([
        ...new Set(responses.map(({ body, statusCode }) => `${statusCode}:${body}`)),
      ]),
    ).toHaveLength(99)
    expect(
      responses
        .filter(({ statusCode }) => statusCode === 409)
        .every(({ json }) => json().code === "PREDICTION_IMMUTABLE"),
    ).toBe(true)
    const effective = await handle.pool.query<{ readonly choice: "yes" | "no" }>(
      "select choice from predictions where goal_id = $1 and predictor_subject_key = 'predictor'",
      [goalId],
    )
    expect(effective.rows).toHaveLength(1)
    const winner = responses.find(({ statusCode }) => statusCode === 201)
    expect(winner?.json().choice).toBe(effective.rows[0]?.choice)
  })

  it("replays 100 concurrent retries sharing one idempotency key", async () => {
    // Given
    const app = server
    const handle = database
    if (app === undefined || handle === undefined) throw new TypeError("fixtures are unavailable")

    // When
    const responses = await Promise.all(
      Array.from({ length: 100 }, () => predictionRequest(app, 0, "same-request")),
    )

    // Then
    expect(responses.filter(({ statusCode }) => statusCode === 201)).toHaveLength(1)
    expect(responses.filter(({ statusCode }) => statusCode === 200)).toHaveLength(99)
    expect(new Set(responses.map(({ body }) => body)).size).toBe(1)
    const count = await handle.pool.query<{ readonly count: string }>(
      "select count(*)::text as count from predictions",
    )
    expect(count.rows).toEqual([{ count: "1" }])
  })

  it("rejects every contender released at the exact cutoff boundary", async () => {
    // Given
    const app = server
    const handle = database
    if (app === undefined || handle === undefined) throw new TypeError("fixtures are unavailable")
    await handle.pool.query(
      "update goals set prediction_cutoff_at = clock_timestamp() where id = $1",
      [goalId],
    )

    // When
    const responses = await Promise.all(
      Array.from({ length: 100 }, (_, index) => predictionRequest(app, index)),
    )

    // Then
    expect(
      responses.every(({ statusCode }) => statusCode === 409),
      JSON.stringify([
        ...new Set(responses.map(({ body, statusCode }) => `${statusCode}:${body}`)),
      ]),
    ).toBe(true)
    expect(responses.every(({ json }) => json().code === "PREDICTION_CLOSED")).toBe(true)
    const count = await handle.pool.query<{ readonly count: string }>(
      "select count(*)::text as count from predictions",
    )
    expect(count.rows).toEqual([{ count: "0" }])
  })
})
