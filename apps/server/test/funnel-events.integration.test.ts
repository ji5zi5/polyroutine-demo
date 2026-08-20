import { readFile } from "node:fs/promises"
import type { EvidenceObjectStore } from "@polyroutine/contracts"
import { analyticsEventSchema } from "@polyroutine/contracts"
import { createDatabase, migrateUp } from "@polyroutine/db"
import type { TestPostgres } from "@polyroutine/testing"
import { startTestPostgres } from "@polyroutine/testing"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createServer } from "../src/app.js"
import { publishPendingAnalyticsEvent } from "../src/modules/analytics/index.js"
import { runGoalLifecycle } from "../src/modules/goals/lifecycle.js"

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)
const owner = "analytics-owner"
const viewer = "analytics-viewer"

const evidenceObjectStore: EvidenceObjectStore = {
  delete: async () => undefined,
  put: async () => undefined,
}
type AnalyticsEventRow = {
  readonly business_key: string
  readonly event_name: string
  readonly payload: unknown
  readonly published_at: Date | null
}

type CohortRow = Readonly<Record<"denominator" | "numerator" | "sample_size", number>>

describe("funnel event integration", () => {
  let database: ReturnType<typeof createDatabase> | undefined
  let now = new Date("2026-08-20T01:00:00.000Z")
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
      clock: { now: () => new Date(now) },
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
    now = new Date("2026-08-20T01:00:00.000Z")
    await handle.pool.query("truncate users cascade")
    await handle.pool.query("truncate analytics_events")
    await handle.pool.query(
      "insert into users(subject_key, timezone) values ($1, 'Asia/Seoul'), ($2, 'UTC')",
      [owner, viewer],
    )
  })

  it("records PII-free daily-loop events and defers an unavailable analytics sink", async () => {
    // Given
    const app = server
    const handle = database
    if (app === undefined || handle === undefined) throw new TypeError("fixtures are unavailable")
    const goal = await handle.pool.query<{ readonly id: string }>(
      `insert into goals(owner_subject_key, local_goal_date, recipe_id, recipe_version, goal_copy,
         prediction_cutoff_at, evidence_deadline_at)
       values ($1, '2026-08-20', 'study_note_photo_v1', 1, '{}', $2, $3)
       returning id::text`,
      [owner, new Date("2099-01-01T00:00:00.000Z"), new Date("2099-01-02T00:00:00.000Z")],
    )
    const goalId = goal.rows[0]?.id
    if (goalId === undefined) throw new TypeError("goal fixture was not created")

    // When
    const feed = await app.inject({
      headers: { "x-subject-key": viewer },
      method: "GET",
      url: "/v1/predictions/feed",
    })
    now = new Date("2026-08-20T01:01:00.000Z")
    const exposure = await app.inject({
      body: { goalId },
      headers: { "idempotency-key": "analytics-exposure", "x-subject-key": viewer },
      method: "POST",
      url: "/v1/predictions/exposures",
    })
    now = new Date("2026-08-20T01:02:00.000Z")
    const prediction = await app.inject({
      body: { choice: "yes" },
      headers: { "idempotency-key": "analytics-prediction", "x-subject-key": viewer },
      method: "POST",
      url: `/v1/predictions/${goalId}`,
    })
    await handle.pool.query("update goals set state = 'evidence_open' where id = $1", [goalId])
    now = new Date("2026-08-20T01:03:00.000Z")
    const challenge = await app.inject({
      headers: { "x-subject-key": owner },
      method: "POST",
      url: `/v1/goals/${goalId}/evidence/challenge`,
    })
    const code = challenge.json().code
    if (typeof code !== "string") throw new TypeError("challenge code is missing")
    const receipt = await app.inject({
      headers: {
        "content-type": "image/png",
        "idempotency-key": "analytics-evidence",
        "x-evidence-challenge": code,
        "x-subject-key": owner,
      },
      method: "POST",
      payload: PNG,
      url: `/v1/goals/${goalId}/evidence`,
    })
    await handle.pool.query("update evidences set state = 'accepted' where goal_id = $1", [goalId])
    now = new Date("2026-08-20T01:04:00.000Z")
    await runGoalLifecycle({ database: handle, now })
    const deferred = await publishPendingAnalyticsEvent(handle, {
      publish: async () => {
        throw new TypeError("analytics sink is unavailable")
      },
    })

    // Then
    expect(feed.statusCode).toBe(200)
    expect(exposure.statusCode).toBe(201)
    expect(prediction.statusCode).toBe(201)
    expect(challenge.statusCode).toBe(201)
    expect(receipt.statusCode).toBe(202)
    if (deferred.delivery !== "deferred") {
      throw new TypeError("analytics sink failure did not defer the pending event")
    }
    expect(
      await handle.pool.query("select state from goals where id = $1", [goalId]),
    ).toMatchObject({ rows: [{ state: "completed" }] })
    expect(
      await handle.pool.query(
        "select sum(points)::integer as points from reputation_events where subject_key = $1",
        [owner],
      ),
    ).toMatchObject({ rows: [{ points: 10 }] })
    const events = await handle.pool.query<AnalyticsEventRow>(
      `select business_key, event_name, payload, published_at from analytics_events
       order by occurred_at, event_sequence`,
    )
    const parsed = events.rows.map(({ payload }) => analyticsEventSchema.parse(payload))
    const firstEvent = events.rows[0]
    if (firstEvent === undefined) throw new TypeError("daily loop emitted no analytics events")
    await expect(
      handle.pool.query(
        `insert into analytics_events(event_name, business_key, schema_version, payload)
         values ($1, $2, 1, $3::jsonb)`,
        [firstEvent.event_name, firstEvent.business_key, JSON.stringify(firstEvent.payload)],
      ),
    ).rejects.toMatchObject({ code: "23505" })
    expect(parsed.map(({ eventName }) => eventName)).toEqual([
      "goal_listed",
      "prediction_shortage_shown",
      "prediction_exposed",
      "prediction_submitted",
      "evidence_submitted",
      "goal_terminal",
      "reputation_event_appended",
    ])
    expect(parsed.find(({ eventName }) => eventName === "goal_terminal")).toMatchObject({
      quorumCount: 1,
      terminalState: "completed",
    })
    expect(JSON.stringify(events.rows)).not.toMatch(/email|object_key|quarantine|free.?text/i)
    expect(events.rows.some(({ published_at }) => published_at === null)).toBe(true)
    const published = await publishPendingAnalyticsEvent(handle, {
      publish: async () => undefined,
    })
    expect(published).toEqual({ delivery: "published", eventId: deferred.eventId })

    const cohortSql = await readFile(
      new URL("../../../docs/analytics/cohorts.sql", import.meta.url),
      "utf8",
    )
    const cohortQueries = new Map(
      cohortSql
        .split(/^-- cohort: /mu)
        .slice(1)
        .map((block) => {
          const newline = block.indexOf("\n")
          return [block.slice(0, newline), block.slice(newline + 1).trim()] as const
        }),
    )
    const window = [new Date("2026-08-20T00:00:00.000Z"), new Date("2026-08-21T00:00:00.000Z")]
    const cohortResults = new Map<string, readonly CohortRow[]>()
    for (const [name, query] of cohortQueries) {
      const result = await handle.pool.query<CohortRow>(query, window)
      cohortResults.set(name, result.rows)
    }
    expect(cohortResults.get("listing_to_submission")).toMatchObject([
      { denominator: 1, numerator: 1, sample_size: 1 },
    ])
    expect(cohortResults.get("submission_to_terminal")).toMatchObject([
      { denominator: 1, numerator: 1, sample_size: 1 },
    ])
    expect(cohortResults.get("terminal_completion")).toMatchObject([
      { denominator: 1, numerator: 1, sample_size: 1 },
    ])
    expect(cohortResults.get("next_local_day_goal")).toMatchObject([
      { denominator: 1, numerator: 0, sample_size: 1 },
    ])
    expect(cohortResults.get("active_retention")).toMatchObject([
      { denominator: 2, numerator: 0, sample_size: 2 },
      { denominator: 2, numerator: 0, sample_size: 2 },
    ])
  })
})
