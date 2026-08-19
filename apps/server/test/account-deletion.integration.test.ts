import { createDatabase, migrateUp } from "@polyroutine/db"
import type { TestPostgres } from "@polyroutine/testing"
import { startTestPostgres } from "@polyroutine/testing"
import type { FastifyInstance } from "fastify"
import { request } from "undici"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { ACCOUNT_ORIGIN, signupPayload, startAccountTestServer } from "./accounts-test-support.js"

const sessionSchema = z.object({ csrfToken: z.string(), token: z.string() })
const signupSchema = z.object({ session: sessionSchema, subjectKey: z.string() })
const loginSchema = z.object({ session: sessionSchema })
const rotationSchema = z.object({ session: sessionSchema })
const deletionSchema = z.object({
  cancelledGoalCount: z.number(),
  imageDeletionJobId: z.string(),
  tombstoneSubjectKey: z.string(),
})

async function jsonRequest(options: {
  readonly address: string
  readonly headers?: Readonly<Record<string, string>>
  readonly method?: "DELETE" | "POST"
  readonly path: string
  readonly payload?: Readonly<Record<string, unknown>>
}) {
  const response = await request(`${options.address}${options.path}`, {
    body: options.payload === undefined ? null : JSON.stringify(options.payload),
    headers: {
      ...(options.payload === undefined ? {} : { "content-type": "application/json" }),
      origin: ACCOUNT_ORIGIN,
      ...options.headers,
    },
    method: options.method ?? "POST",
  })
  const text = await response.body.text()
  return { body: text.length === 0 ? null : JSON.parse(text), statusCode: response.statusCode }
}

describe("account deletion integration", () => {
  let address = ""
  let database: ReturnType<typeof createDatabase> | undefined
  let postgres: TestPostgres | undefined
  let server: FastifyInstance | undefined

  beforeAll(async () => {
    postgres = await startTestPostgres()
    database = createDatabase(postgres.connectionString)
    await migrateUp(database)
    const fixture = await startAccountTestServer(database)
    address = fixture.address
    server = fixture.server
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
    await handle.pool.query("truncate login_rate_limits")
  })

  it("revokes only the presented session on logout", async () => {
    // Given
    const signup = signupSchema.parse(
      (await jsonRequest({ address, path: "/v1/accounts/signup", payload: signupPayload })).body,
    )
    const login = loginSchema.parse(
      (
        await jsonRequest({
          address,
          path: "/v1/accounts/login",
          payload: {
            email: signupPayload.email,
            password: signupPayload.password,
          },
        })
      ).body,
    )

    // When
    const logout = await jsonRequest({
      address,
      headers: {
        authorization: `Bearer ${signup.session.token}`,
        "x-csrf-token": signup.session.csrfToken,
      },
      path: "/v1/accounts/logout",
    })

    // Then
    expect(logout.statusCode).toBe(204)
    const stillActive = await jsonRequest({
      address,
      headers: {
        authorization: `Bearer ${login.session.token}`,
        "x-csrf-token": login.session.csrfToken,
      },
      path: "/v1/accounts/session/rotate",
    })
    expect(stillActive.statusCode).toBe(200)
  })

  it("unlinks retained records, cancels active goals, queues image deletion, and revokes sessions", async () => {
    // Given
    const signup = signupSchema.parse(
      (
        await jsonRequest({
          address,
          path: "/v1/accounts/signup",
          payload: signupPayload,
        })
      ).body,
    )
    const login = loginSchema.parse(
      (
        await jsonRequest({
          address,
          path: "/v1/accounts/login",
          payload: { email: signupPayload.email, password: signupPayload.password },
        })
      ).body,
    )
    const rotated = rotationSchema.parse(
      (
        await jsonRequest({
          address,
          headers: {
            authorization: `Bearer ${login.session.token}`,
            "x-csrf-token": login.session.csrfToken,
          },
          path: "/v1/accounts/session/rotate",
        })
      ).body,
    )
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    const goalId = "00000000-0000-4000-8000-000000000404"
    await handle.pool.query(
      `insert into goals(id, owner_subject_key, local_goal_date, recipe_id, recipe_version,
         goal_copy, prediction_cutoff_at, evidence_deadline_at)
       values ($1, $2, '2026-08-20', 'study_note_photo_v1', 1, 'delete me',
         clock_timestamp() + interval '1 hour', clock_timestamp() + interval '2 hours')`,
      [goalId, signup.subjectKey],
    )
    await handle.pool.query(
      `insert into evidences(goal_id, owner_subject_key, attempt_number, business_key)
       values ($1, $2, 1, 'evidence:deletion')`,
      [goalId, signup.subjectKey],
    )
    await handle.pool.query(
      `insert into reputation_events(subject_key, business_key, event_kind, points)
       values ($1, 'reputation:deletion', 'award', 5)`,
      [signup.subjectKey],
    )
    await handle.pool.query(
      `insert into goal_correction_events(goal_id, operator_subject_key, corrected_state,
         reason, business_key) values ($1, $2, 'cancelled', 'retained audit', 'correction:deletion')`,
      [goalId, signup.subjectKey],
    )

    // When
    const deletionResponse = await jsonRequest({
      address,
      headers: {
        authorization: `Bearer ${rotated.session.token}`,
        "x-csrf-token": rotated.session.csrfToken,
      },
      method: "DELETE",
      path: "/v1/accounts/me",
    })

    // Then
    expect(deletionResponse.statusCode).toBe(200)
    const deletion = deletionSchema.parse(deletionResponse.body)
    expect(deletion.cancelledGoalCount).toBe(1)
    expect(deletion.tombstoneSubjectKey).toMatch(/^deleted:/)
    const state = await handle.pool.query<{
      readonly accounts: string
      readonly audits: string
      readonly jobs: string
      readonly old_users: string
      readonly sessions: string
    }>(
      `select
         (select count(*) from accounts)::text as accounts,
         (select count(*) from account_deletion_audits)::text as audits,
         (select count(*) from account_deletion_jobs where state = 'queued')::text as jobs,
         (select count(*) from users where subject_key = $1)::text as old_users,
         (select count(*) from sessions)::text as sessions`,
      [signup.subjectKey],
    )
    expect(state.rows[0]).toEqual({
      accounts: "0",
      audits: "1",
      jobs: "1",
      old_users: "0",
      sessions: "0",
    })
    const retained = await handle.pool.query<{
      readonly evidence_owner: string
      readonly correction_operator: string
      readonly goal_owner: string
      readonly reputation_subject: string
      readonly state: string
    }>(
      `select g.owner_subject_key as goal_owner, g.state,
         e.owner_subject_key as evidence_owner,
         (select subject_key from reputation_events where business_key = 'reputation:deletion')
           as reputation_subject,
         (select operator_subject_key from goal_correction_events
           where business_key = 'correction:deletion') as correction_operator
       from goals g join evidences e on e.goal_id = g.id where g.id = $1`,
      [goalId],
    )
    expect(retained.rows[0]).toEqual({
      correction_operator: deletion.tombstoneSubjectKey,
      evidence_owner: deletion.tombstoneSubjectKey,
      goal_owner: deletion.tombstoneSubjectKey,
      reputation_subject: deletion.tombstoneSubjectKey,
      state: "cancelled",
    })
    const serializedDatabase = JSON.stringify(await handle.pool.query("select * from accounts"))
    expect(serializedDatabase).not.toContain(signupPayload.email)

    const deletedSession = await jsonRequest({
      address,
      headers: {
        authorization: `Bearer ${rotated.session.token}`,
        "x-csrf-token": rotated.session.csrfToken,
      },
      path: "/v1/accounts/session/rotate",
    })
    expect(deletedSession.statusCode).toBe(401)
    const unchanged = await handle.pool.query<{ readonly audits: string; readonly jobs: string }>(
      "select (select count(*) from account_deletion_audits)::text as audits, (select count(*) from account_deletion_jobs)::text as jobs",
    )
    expect(unchanged.rows[0]).toEqual({ audits: "1", jobs: "1" })
  })
})
