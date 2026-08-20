import type { EvidenceObjectStore } from "@polyroutine/contracts"
import { createDatabase, migrateUp } from "@polyroutine/db"
import type { TestPostgres } from "@polyroutine/testing"
import { startTestPostgres } from "@polyroutine/testing"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createServer } from "../src/app.js"
import { runGoalLifecycle } from "../src/modules/goals/lifecycle.js"

const owners = ["owner-one", "owner-two", "owner-three", "owner-four"] as const
const predictor = "predictor"
const evidenceObjectStore: EvidenceObjectStore = {
  delete: async () => undefined,
  put: async () => undefined,
}
describe("goal-lifecycle integration", () => {
  let database: ReturnType<typeof createDatabase> | undefined
  let now = new Date("2026-08-19T00:00:00.000Z")
  let postgres: TestPostgres | undefined
  let server: FastifyInstance | undefined
  let uuidSequence = 100

  beforeAll(async () => {
    postgres = await startTestPostgres()
    database = createDatabase(postgres.connectionString)
    await migrateUp(database)
    server = createServer({
      accounts: {
        audit: { write: () => undefined },
        expectedOrigin: "http://127.0.0.1:3100",
        sessionSecret: "0123456789abcdef0123456789abcdef",
      },
      clock: { now: () => new Date(now) },
      database,
      evidenceObjectStore,
      uuid: {
        create: () => `00000000-0000-4000-8000-${String(uuidSequence++).padStart(12, "0")}`,
      },
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
    now = new Date("2026-08-19T00:00:00.000Z")
    await handle.pool.query("truncate users cascade")
    await handle.pool.query("truncate reputation_events, analytics_events")
    await handle.pool.query(
      "insert into users(subject_key, timezone) select subject_key, 'Asia/Seoul' from unnest($1::text[]) subject_key",
      [[...owners, predictor]],
    )
  })

  async function createGoal(owner: string, noteLineTarget = 3) {
    const app = server
    if (app === undefined) throw new TypeError("server fixture is unavailable")
    return app.inject({
      body: { noteLineTarget, studyMinutes: 25 },
      headers: { "x-subject-key": owner },
      method: "POST",
      url: "/v1/goals",
    })
  }

  it("uses the server clock and rejects client-owned timing fields", async () => {
    // Given
    const app = server
    if (app === undefined) throw new TypeError("server fixture is unavailable")

    // When
    const created = await createGoal(owners[0])
    const malformed = await app.inject({
      body: {
        evidenceDeadlineAt: "2099-01-01T00:00:00.000Z",
        noteLineTarget: 3,
        studyMinutes: 25,
      },
      headers: { "x-subject-key": owners[1] },
      method: "POST",
      url: "/v1/goals",
    })

    // Then
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      evidenceDeadlineAt: "2026-08-19T12:00:00.000Z",
      localGoalDate: "2026-08-19",
      predictionCutoffAt: "2026-08-19T00:30:00.000Z",
      recipeId: "study_note_photo_v1",
      recipeVersion: 1,
      state: "prediction_open",
    })
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json()).toMatchObject({ code: "INVALID_GOAL_REQUEST" })
  })

  it("allows only one goal per owner local day under concurrent creation", async () => {
    // Given
    const requests = [createGoal(owners[0]), createGoal(owners[0])]

    // When
    const responses = await Promise.all(requests)

    // Then
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([201, 409])
  })

  it("blocks owner update and cancellation after the first effective prediction", async () => {
    // Given
    const app = server
    const handle = database
    if (app === undefined || handle === undefined) throw new TypeError("fixtures are unavailable")
    now = new Date()
    const created = await createGoal(owners[0])
    const goalId = created.json().id
    await handle.pool.query(
      "insert into predictions(goal_id, predictor_subject_key, choice, business_key) values ($1, $2, 'yes', 'prediction:immutability')",
      [goalId, predictor],
    )

    // When
    const [updated, cancelled] = await Promise.all([
      app.inject({
        body: { noteLineTarget: 4, studyMinutes: 25 },
        headers: { "x-subject-key": owners[0] },
        method: "PATCH",
        url: `/v1/goals/${goalId}`,
      }),
      app.inject({
        body: { actor: "owner" },
        headers: { "idempotency-key": "cancel-after-vote", "x-subject-key": owners[0] },
        method: "POST",
        url: `/v1/goals/${goalId}/cancel`,
      }),
    ])

    // Then
    expect(updated.statusCode).toBe(409)
    expect(updated.json()).toMatchObject({ code: "GOAL_IMMUTABLE" })
    expect(cancelled.statusCode).toBe(409)
    expect(cancelled.json()).toMatchObject({ code: "GOAL_IMMUTABLE" })
    const state = await handle.pool.query<{ readonly state: string }>(
      "select state from goals where id = $1",
      [goalId],
    )
    expect(state.rows).toEqual([{ state: "prediction_open" }])
  })

  it("cancels an eligible owner goal with an idempotent audit", async () => {
    // Given
    const app = server
    const handle = database
    if (app === undefined || handle === undefined) throw new TypeError("fixtures are unavailable")
    const created = await createGoal(owners[0])
    const goalId = created.json().id
    const request = {
      body: { actor: "owner" },
      headers: { "idempotency-key": "owner-cancel-one", "x-subject-key": owners[0] },
      method: "POST" as const,
      url: `/v1/goals/${goalId}/cancel`,
    }

    // When
    const responses = await Promise.all([app.inject(request), app.inject(request)])

    // Then
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([200, 200])
    const audits = await handle.pool.query<{ readonly count: string }>(
      "select count(*)::text as count from analytics_events where payload->>'toState' = 'cancelled'",
    )
    expect(audits.rows).toEqual([{ count: "1" }])
  })

  it("opens prediction goals at cutoff even with zero votes", async () => {
    // Given
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    const created = await createGoal(owners[0])
    const goalId = created.json().id
    now = new Date("2026-08-19T00:30:00.000Z")

    // When
    await runGoalLifecycle({ database: handle, now })

    // Then
    const result = await handle.pool.query<{ readonly state: string }>(
      "select state from goals where id = $1",
      [goalId],
    )
    expect(result.rows).toEqual([{ state: "evidence_open" }])
  })

  it("converges accepted, final rejected, empty, and unresolved evidence to terminals", async () => {
    // Given
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    const goalIds = await Promise.all(
      owners.map(async (owner) => (await createGoal(owner)).json().id),
    )
    await handle.pool.query("update goals set state = 'evidence_open' where id = any($1::uuid[])", [
      goalIds,
    ])
    await handle.pool.query(
      `insert into evidences(goal_id, owner_subject_key, attempt_number, business_key, state, received_at)
       values ($1, $4, 1, 'accepted', 'accepted', $5),
              ($2, $4, 1, 'rejected-one', 'rejected', $5),
              ($2, $4, 2, 'rejected-two', 'rejected', $5),
              ($3, $4, 1, 'pending', 'pending', $5)`,
      [goalIds[0], goalIds[1], goalIds[3], owners[0], now],
    )
    now = new Date("2026-08-19T12:15:00.001Z")

    // When
    await runGoalLifecycle({ database: handle, now })

    // Then
    const states = await handle.pool.query<{ readonly id: string; readonly state: string }>(
      "select id::text, state from goals where id = any($1::uuid[])",
      [goalIds],
    )
    const stateById = new Map(states.rows.map(({ id, state }) => [id, state]))
    expect(goalIds.map((goalId) => stateById.get(goalId))).toEqual([
      "completed",
      "failed",
      "expired",
      "expired",
    ])
  })

  it("keeps transition audits ordered and duplicate scheduler invocation idempotent", async () => {
    // Given
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    const created = await createGoal(owners[0])
    const goalId = created.json().id
    now = new Date("2026-08-19T00:30:00.000Z")
    await runGoalLifecycle({ database: handle, now })
    await handle.pool.query(
      "insert into evidences(goal_id, owner_subject_key, attempt_number, business_key, state) values ($1, $2, 1, 'accepted:audit', 'accepted')",
      [goalId, owners[0]],
    )
    now = new Date("2026-08-19T00:30:00.001Z")

    // When
    await Promise.all([
      runGoalLifecycle({ database: handle, now }),
      runGoalLifecycle({ database: handle, now }),
    ])

    // Then
    const audits = await handle.pool.query<{ readonly to_state: string }>(
      `select payload->>'toState' as to_state from analytics_events
       where payload->>'goalId' = $1 order by occurred_at`,
      [goalId],
    )
    expect(audits.rows.map(({ to_state }) => to_state)).toEqual([
      "prediction_open",
      "evidence_open",
      "completed",
    ])
  })

  it("allows a reasoned operator cancellation after cutoff", async () => {
    // Given
    const app = server
    const handle = database
    if (app === undefined || handle === undefined) throw new TypeError("fixtures are unavailable")
    const goalId = (await createGoal(owners[0])).json().id
    now = new Date("2026-08-19T00:30:00.000Z")
    await runGoalLifecycle({ database: handle, now })

    // When
    const response = await app.inject({
      body: { actor: "operator", reason: "owner requested support" },
      headers: { "idempotency-key": "operator-cancel", "x-subject-key": predictor },
      method: "POST",
      url: `/v1/goals/${goalId}/cancel`,
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ state: "cancelled" })
    const audit = await handle.pool.query<{ readonly from_state: string }>(
      "select payload->>'fromState' as from_state from analytics_events where business_key = $1",
      [`goal:${goalId}:cancel:operator-cancel`],
    )
    expect(audit.rows).toEqual([{ from_state: "evidence_open" }])
  })
})
