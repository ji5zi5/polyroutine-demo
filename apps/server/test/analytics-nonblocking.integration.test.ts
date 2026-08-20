import type { EvidenceObjectStore } from "@polyroutine/contracts"
import { createDatabase, migrateUp } from "@polyroutine/db"
import type { TestPostgres } from "@polyroutine/testing"
import { startTestPostgres } from "@polyroutine/testing"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createServer } from "../src/app.js"
import { analyticsCohortContext, appendAnalyticsEvent } from "../src/modules/analytics/index.js"
import { runGoalLifecycle } from "../src/modules/goals/lifecycle.js"

const owner = "nonblocking-owner"
const viewer = "nonblocking-viewer"
const now = new Date("2026-08-20T01:00:00.000Z")
const evidenceObjectStore: EvidenceObjectStore = {
  delete: async () => undefined,
  put: async () => undefined,
}
describe("analytics failure isolation", () => {
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
    await database.pool.query(`
      create or replace function task12_reject_analytics_insert() returns trigger language plpgsql as $$
      begin
        raise exception using errcode = 'P0001', message = 'ANALYTICS_UNAVAILABLE';
      end;
      $$;
      create trigger task12_reject_analytics_insert before insert on analytics_events
      for each row execute function task12_reject_analytics_insert();
    `)
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
    if (database !== undefined) {
      await database.pool.query("drop trigger task12_reject_analytics_insert on analytics_events")
      await database.pool.query("drop function task12_reject_analytics_insert()")
      await database.destroy()
    }
    if (postgres !== undefined) await postgres.container.stop()
  })

  beforeEach(async () => {
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    await handle.pool.query("truncate users cascade")
    await handle.pool.query("truncate reputation_events, analytics_events")
    await handle.pool.query(
      "insert into users(subject_key, timezone) values ($1, 'Asia/Seoul'), ($2, 'UTC')",
      [owner, viewer],
    )
  })

  it("keeps listing, exposure, and prediction successful when analytics storage rejects writes", async () => {
    // Given
    const app = server
    const handle = database
    if (app === undefined || handle === undefined) throw new TypeError("fixtures are unavailable")
    const goal = await handle.pool.query<{ readonly id: string }>(
      `insert into goals(owner_subject_key, local_goal_date, recipe_id, recipe_version, goal_copy,
         prediction_cutoff_at, evidence_deadline_at)
       values ($1, '2026-08-20', 'study_note_photo_v1', 1, '{}', '2099-01-01', '2099-01-02')
       returning id::text`,
      [owner],
    )
    const goalId = goal.rows[0]?.id
    if (goalId === undefined) throw new TypeError("goal fixture was not created")

    // When
    const feed = await app.inject({
      headers: { "x-subject-key": viewer },
      method: "GET",
      url: "/v1/predictions/feed",
    })
    const exposure = await app.inject({
      body: { goalId },
      headers: { "idempotency-key": "nonblocking-exposure", "x-subject-key": viewer },
      method: "POST",
      url: "/v1/predictions/exposures",
    })
    const prediction = await app.inject({
      body: { choice: "yes" },
      headers: { "idempotency-key": "nonblocking-prediction", "x-subject-key": viewer },
      method: "POST",
      url: `/v1/predictions/${goalId}`,
    })

    // Then
    expect([feed.statusCode, exposure.statusCode, prediction.statusCode]).toEqual([200, 201, 201])
    expect(
      await handle.pool.query("select choice from predictions where goal_id = $1", [goalId]),
    ).toMatchObject({ rows: [{ choice: "yes" }] })
  })

  it("keeps terminal completion successful when analytics storage rejects writes", async () => {
    // Given
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    const goal = await handle.pool.query<{ readonly id: string }>(
      `insert into goals(owner_subject_key, local_goal_date, recipe_id, recipe_version, goal_copy,
         prediction_cutoff_at, evidence_deadline_at, state)
       values ($1, '2026-08-20', 'study_note_photo_v1', 1, '{}', '2026-08-19', '2099-01-02', 'evidence_open')
       returning id::text`,
      [owner],
    )
    const goalId = goal.rows[0]?.id
    if (goalId === undefined) throw new TypeError("goal fixture was not created")
    await handle.pool.query(
      `insert into evidences(goal_id, owner_subject_key, attempt_number, business_key, state)
       values ($1, $2, 1, $3, 'accepted')`,
      [goalId, owner, `accepted:${goalId}`],
    )

    // When
    await runGoalLifecycle({ database: handle, now })

    // Then
    expect(
      await handle.pool.query("select state from goals where id = $1", [goalId]),
    ).toMatchObject({ rows: [{ state: "completed" }] })
  })

  it("keeps reputation settlement committed when analytics storage rejects writes", async () => {
    // Given
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    const goalId = crypto.randomUUID()
    const client = await handle.pool.connect()
    let committed = false

    // When
    await client.query("begin")
    try {
      await client.query(
        `insert into reputation_events(subject_key, business_key, event_kind, points)
         values ($1, $2, 'award', 15)`,
        [owner, `settlement:${goalId}`],
      )
      await appendAnalyticsEvent(client, {
        businessKey: `reputation-event:${goalId}`,
        event: {
          ...(await analyticsCohortContext(client, owner, now)),
          eventKind: "award",
          eventName: "reputation_event_appended",
          eventVersion: 1,
          goalId,
          points: 15,
          quorumCount: 1,
          recipeId: "study_note_photo_v1",
          recipeVersion: 1,
        },
        occurredAt: now,
      })
      await client.query("commit")
      committed = true
    } finally {
      if (!committed) await client.query("rollback")
      client.release()
    }

    // Then
    expect(
      await handle.pool.query("select points from reputation_events where business_key = $1", [
        `settlement:${goalId}`,
      ]),
    ).toMatchObject({ rows: [{ points: 15 }] })
    expect(
      (await handle.pool.query("select count(*)::integer as count from analytics_events")).rows,
    ).toEqual([{ count: 0 }])
  })
})
