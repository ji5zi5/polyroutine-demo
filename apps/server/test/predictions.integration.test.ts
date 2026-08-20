import type { EvidenceObjectStore } from "@polyroutine/contracts"
import { createDatabase, migrateUp } from "@polyroutine/db"
import type { TestPostgres } from "@polyroutine/testing"
import { startTestPostgres } from "@polyroutine/testing"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { createServer } from "../src/app.js"

const viewer = "viewer"
const owners = ["owner-a", "owner-b", "owner-c", "owner-d", "owner-e", "owner-f"] as const
const evidenceObjectStore: EvidenceObjectStore = {
  delete: async () => undefined,
  put: async () => undefined,
}
const cardSchema = z.strictObject({
  anonymousAlias: z.string().min(1),
  evidenceDeadlineAt: z.string().datetime(),
  goalId: z.string().uuid(),
  predictionCutoffAt: z.string().datetime(),
  recipe: z.strictObject({
    id: z.literal("study_note_photo_v1"),
    instructions: z.string().min(1),
    version: z.literal(1),
  }),
})
const feedSchema = z.strictObject({
  cards: z.array(cardSchema).max(5),
  shortage: z
    .strictObject({
      nextRefreshAt: z.string().datetime(),
      reason: z.literal("eligible_pool_exhausted"),
      requested: z.literal(5),
      returned: z.number().int().min(0).max(4),
    })
    .nullable(),
})

describe("predictions integration", () => {
  let database: ReturnType<typeof createDatabase> | undefined
  let goalSequence = 0
  let now = new Date("2026-08-19T09:00:00.000Z")
  let postgres: TestPostgres | undefined
  let server: FastifyInstance | undefined

  beforeAll(async () => {
    postgres = await startTestPostgres()
    database = createDatabase(postgres.connectionString)
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
    goalSequence = 0
    now = new Date("2026-08-19T09:00:00.000Z")
    await handle.pool.query("truncate users cascade")
    await handle.pool.query("truncate analytics_events")
    await handle.pool.query(
      "insert into users(subject_key, timezone) select subject_key, 'UTC' from unnest($1::text[]) subject_key",
      [[viewer, ...owners]],
    )
  })

  async function addGoal(owner: string): Promise<string> {
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    goalSequence += 1
    const fixtureId = `00000000-0000-4000-8000-${String(goalSequence).padStart(12, "0")}`
    const result = await handle.pool.query<{ readonly id: string }>(
      `insert into goals(id, owner_subject_key, local_goal_date, recipe_id, recipe_version, goal_copy,
         prediction_cutoff_at, evidence_deadline_at)
       values ($1, $2, current_date, 'study_note_photo_v1', 1,
         '{"studyMinutes":25,"noteLineTarget":3}', clock_timestamp() + interval '1 hour',
         clock_timestamp() + interval '12 hours')
       returning id::text`,
      [fixtureId, owner],
    )
    const id = result.rows[0]?.id
    if (id === undefined) throw new TypeError("goal fixture was not created")
    return id
  }

  async function getFeed() {
    const app = server
    if (app === undefined) throw new TypeError("server fixture is unavailable")
    const response = await app.inject({
      headers: { "x-subject-key": viewer },
      method: "GET",
      url: "/v1/predictions/feed",
    })
    expect(response.statusCode).toBe(200)
    return feedSchema.parse(response.json())
  }

  it("returns truthful 0, 1, 3, and 5-card feeds without fake cards", async () => {
    // Given / When / Then
    for (const expected of [0, 1, 3, 5] as const) {
      const handle = database
      if (handle === undefined) throw new TypeError("database fixture is unavailable")
      await handle.pool.query("truncate goals cascade")
      for (const owner of owners.slice(0, expected)) await addGoal(owner)
      const feed = await getFeed()
      expect(feed.cards).toHaveLength(expected)
      expect(feed.shortage?.returned ?? 5).toBe(expected)
    }
  })

  it("excludes self and already-predicted goals and orders cold goals deterministically", async () => {
    // Given
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    const selfGoal = await addGoal(viewer)
    const goalIds = await Promise.all(owners.slice(0, 5).map(addGoal))
    await handle.pool.query(
      `insert into predictions(goal_id, predictor_subject_key, choice, business_key)
       values ($1, 'prior-viewer', 'yes', 'prior:one'),
              ($1, 'prior-viewer-2', 'no', 'prior:two'),
              ($2, $3, 'yes', 'viewer:already')`,
      [goalIds[0], goalIds[1], viewer],
    )

    // When
    const first = await getFeed()
    const repeated = await getFeed()
    now = new Date("2026-08-20T09:00:00.000Z")
    const rotated = await getFeed()

    // Then
    expect(first.cards.map(({ goalId }) => goalId)).toEqual(
      repeated.cards.map(({ goalId }) => goalId),
    )
    expect(first.cards.map(({ goalId }) => goalId)).not.toContain(selfGoal)
    expect(first.cards.map(({ goalId }) => goalId)).not.toContain(goalIds[1])
    expect(first.cards.at(-1)?.goalId).toBe(goalIds[0])
    expect(rotated.cards.map(({ goalId }) => goalId)).not.toEqual(
      first.cards.map(({ goalId }) => goalId),
    )
  })

  it("records duplicate exposure idempotently and emits truthful shortage analytics", async () => {
    // Given
    const app = server
    const handle = database
    if (app === undefined || handle === undefined) throw new TypeError("fixtures are unavailable")
    const goalId = await addGoal(owners[0])
    const request = {
      body: { goalId },
      headers: { "idempotency-key": "exposure-one", "x-subject-key": viewer },
      method: "POST" as const,
      url: "/v1/predictions/exposures",
    }

    // When
    await getFeed()
    const responses = await Promise.all([app.inject(request), app.inject(request)])

    // Then
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 201])
    const counts = await handle.pool.query<{
      readonly exposures: string
      readonly shortages: string
    }>(
      `select (select count(*) from feed_exposures)::text as exposures,
         (select count(*) from analytics_events
          where event_name = 'prediction_shortage_shown')::text as shortages`,
    )
    expect(counts.rows).toEqual([{ exposures: "1", shortages: "1" }])
  })

  it("replays one vote by idempotency key and rejects immutable duplicates", async () => {
    // Given
    const app = server
    const handle = database
    if (app === undefined || handle === undefined) throw new TypeError("fixtures are unavailable")
    const goalId = await addGoal(owners[0])
    const submit = (choice: "yes" | "no", key: string) =>
      app.inject({
        body: { choice },
        headers: { "idempotency-key": key, "x-subject-key": viewer },
        method: "POST",
        url: `/v1/predictions/${goalId}`,
      })

    // When
    const created = await submit("yes", "vote-one")
    const replayed = await submit("yes", "vote-one")
    const opposite = await submit("no", "vote-one")
    const differentKey = await submit("yes", "vote-two")

    // Then
    expect(created.statusCode).toBe(201)
    expect(replayed.statusCode).toBe(200)
    expect(replayed.json()).toEqual(created.json())
    expect(opposite.statusCode).toBe(409)
    expect(opposite.json()).toMatchObject({ code: "PREDICTION_IMMUTABLE", replacement: true })
    expect(differentKey.statusCode).toBe(409)
    const count = await handle.pool.query<{ readonly count: string }>(
      "select count(*)::text as count from predictions",
    )
    expect(count.rows).toEqual([{ count: "1" }])
  })

  it("serves two users over TCP without owner identity, crowd totals, leases, or fake liquidity", async () => {
    // Given
    const app = server
    const handle = database
    if (app === undefined || handle === undefined) throw new TypeError("fixtures are unavailable")
    const goalIds = await Promise.all(owners.slice(0, 3).map(addGoal))
    const terminalGoalId = await addGoal(owners[5])
    await handle.pool.query("update goals set state = 'completed' where id = $1", [terminalGoalId])
    const origin = await app.listen({ host: "127.0.0.1", port: 0 })

    // When
    const viewerFeedResponse = await fetch(`${origin}/v1/predictions/feed`, {
      headers: { "x-subject-key": viewer },
    })
    const ownerFeedResponse = await fetch(`${origin}/v1/predictions/feed`, {
      headers: { "x-subject-key": owners[0] },
    })
    const viewerFeed = feedSchema.parse(await viewerFeedResponse.json())
    const ownerFeed = feedSchema.parse(await ownerFeedResponse.json())
    const viewerVote = await fetch(`${origin}/v1/predictions/${goalIds[0]}`, {
      body: JSON.stringify({ choice: "yes" }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "tcp-viewer-vote",
        "x-subject-key": viewer,
      },
      method: "POST",
    })
    const ownerVote = await fetch(`${origin}/v1/predictions/${goalIds[1]}`, {
      body: JSON.stringify({ choice: "no" }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "tcp-owner-vote",
        "x-subject-key": owners[0],
      },
      method: "POST",
    })
    const schemaState = await handle.pool.query<{ readonly reservations: string | null }>(
      "select to_regclass('public.prediction_reservations')::text as reservations",
    )

    // Then
    expect(viewerFeedResponse.status).toBe(200)
    expect(ownerFeedResponse.status).toBe(200)
    expect(viewerFeed.cards).toHaveLength(3)
    expect(ownerFeed.cards).toHaveLength(2)
    expect(ownerFeed.cards.map(({ goalId }) => goalId)).not.toContain(goalIds[0])
    expect(viewerFeed.cards.map(({ goalId }) => goalId)).not.toContain(terminalGoalId)
    expect(JSON.stringify(viewerFeed.cards)).not.toMatch(/owner-|viewer|effective|count|crowd/i)
    expect(viewerVote.status).toBe(201)
    expect(ownerVote.status).toBe(201)
    expect(schemaState.rows).toEqual([{ reservations: null }])
  })

  it("rejects malformed input, self prediction, and the exact database cutoff", async () => {
    // Given
    const app = server
    const handle = database
    if (app === undefined || handle === undefined) throw new TypeError("fixtures are unavailable")
    const selfGoal = await addGoal(viewer)
    const cutoffGoal = await addGoal(owners[0])
    await handle.pool.query(
      "update goals set prediction_cutoff_at = clock_timestamp() where id = $1",
      [cutoffGoal],
    )

    // When
    const responses = await Promise.all(
      [
        { body: { choice: "maybe" }, goalId: cutoffGoal, key: "malformed" },
        { body: { choice: "yes" }, goalId: selfGoal, key: "self" },
        { body: { choice: "yes" }, goalId: cutoffGoal, key: "cutoff" },
      ].map(({ body, goalId, key }) =>
        app.inject({
          body,
          headers: { "idempotency-key": key, "x-subject-key": viewer },
          method: "POST",
          url: `/v1/predictions/${goalId}`,
        }),
      ),
    )

    // Then
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([400, 409, 409])
    expect(responses[2]?.json()).toMatchObject({ code: "PREDICTION_CLOSED", replacement: true })
  })
})
