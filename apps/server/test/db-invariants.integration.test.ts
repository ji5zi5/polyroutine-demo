import { createDatabase, migrateDown, migrateUp } from "@polyroutine/db"
import type { TestPostgres } from "@polyroutine/testing"
import { startTestPostgres } from "@polyroutine/testing"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const owner = "owner-subject"
const predictor = "predictor-subject"
const goalId = "00000000-0000-4000-8000-000000000101"

async function expectDbError(action: () => Promise<unknown>, message: string): Promise<void> {
  await expect(action).rejects.toMatchObject({
    code: "P0001",
    message: expect.stringContaining(message),
  })
}

describe("PostgreSQL daily-loop invariants", () => {
  let database: ReturnType<typeof createDatabase> | undefined
  let postgres: TestPostgres | undefined

  beforeAll(async () => {
    postgres = await startTestPostgres()
    database = createDatabase(postgres.connectionString)
    await migrateUp(database)
  }, 120_000)

  afterAll(async () => {
    if (database !== undefined) await database.destroy()
    if (postgres !== undefined) await postgres.container.stop()
  })

  beforeEach(async () => {
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    await handle.pool.query("truncate users cascade")
    await handle.pool.query("truncate reputation_events, analytics_events")
    await handle.pool.query(
      "insert into users(subject_key, timezone) values ($1, 'Asia/Seoul'), ($2, 'UTC')",
      [owner, predictor],
    )
    await handle.pool.query(
      `insert into goals(id, owner_subject_key, local_goal_date, recipe_id, recipe_version,
         goal_copy, prediction_cutoff_at, evidence_deadline_at)
       values ($1, $2, '2026-08-20', 'study_note_photo_v1', 1, 'guided',
         clock_timestamp() + interval '1 minute', clock_timestamp() + interval '2 hours')`,
      [goalId, owner],
    )
  })

  it("migrates up, down, and up on an empty PostgreSQL database", async () => {
    // Given
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")

    // When
    await migrateDown(handle)
    await migrateUp(handle)

    // Then
    const result = await handle.pool.query<{ readonly name: string }>(
      "select to_regclass('public.goals')::text as name",
    )
    expect(result.rows).toEqual([{ name: "goals" }])
  })

  it("normalizes valid Seoul and New York local deadlines to UTC", async () => {
    // Given
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")

    // When
    const result = await handle.pool.query<{ readonly utc: string }>(
      `select to_char(normalize_local_time($1, $2, null) at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"') as utc
       union all
       select to_char(normalize_local_time($3, $4, null) at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"') as utc`,
      ["2026-08-20 21:00", "Asia/Seoul", "2026-08-20 21:00", "America/New_York"],
    )

    // Then
    expect(result.rows).toEqual([{ utc: "2026-08-20T12:00:00Z" }, { utc: "2026-08-21T01:00:00Z" }])
  })

  it("rejects DST gaps and folds without a valid explicit offset", async () => {
    // Given
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")

    // When / Then
    await expectDbError(
      () =>
        handle.pool.query("select normalize_local_time($1, $2, null)", [
          "2026-03-08 02:30",
          "America/New_York",
        ]),
      "PR_DST_NONEXISTENT",
    )
    await expectDbError(
      () =>
        handle.pool.query("select normalize_local_time($1, $2, null)", [
          "2026-11-01 01:30",
          "America/New_York",
        ]),
      "PR_DST_AMBIGUOUS",
    )
    const fold = await handle.pool.query<{ readonly utc: string }>(
      `select to_char(normalize_local_time('2026-11-01 01:30', 'America/New_York', offset_minutes)
         at time zone 'UTC', 'HH24:MI') as utc
       from unnest(array[-240, -300]) offset_minutes order by utc`,
    )
    expect(fold.rows).toEqual([{ utc: "05:30" }, { utc: "06:30" }])
  })

  it("preserves daily uniqueness and prediction atomicity", async () => {
    // Given
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    // When / Then
    await expectDbError(
      () =>
        handle.pool.query("select insert_prediction($1, $2, 'yes', $3)", [
          goalId,
          owner,
          "prediction:self",
        ]),
      "PR_SELF_PREDICTION",
    )
    await expectDbError(
      () =>
        handle.pool.query(
          "insert into predictions(goal_id, predictor_subject_key, choice, business_key) values ($1, $2, 'yes', 'prediction:direct-self')",
          [goalId, owner],
        ),
      "PR_SELF_PREDICTION",
    )
    await handle.pool.query("select insert_prediction($1, $2, 'yes', $3)", [
      goalId,
      predictor,
      "prediction:one",
    ])
    await expectDbError(
      () =>
        handle.pool.query("select insert_prediction($1, $2, 'no', $3)", [
          goalId,
          predictor,
          "prediction:two",
        ]),
      "PR_DUPLICATE_PREDICTION",
    )
    await expect(
      handle.pool.query(
        `insert into goals(id, owner_subject_key, local_goal_date, recipe_id, recipe_version,
           goal_copy, prediction_cutoff_at, evidence_deadline_at)
         values (gen_random_uuid(), $1, '2026-08-20', 'study_note_photo_v1', 1, 'other',
           clock_timestamp() + interval '1 minute', clock_timestamp() + interval '2 hours')`,
        [owner],
      ),
    ).rejects.toMatchObject({ code: "23505" })
    await handle.pool.query(
      "update goals set prediction_cutoff_at = clock_timestamp() where id = $1",
      [goalId],
    )
    await expectDbError(
      () =>
        handle.pool.query(
          "select insert_prediction($1, 'other-subject', 'yes', 'prediction:late')",
          [goalId],
        ),
      "PR_PREDICTION_CUTOFF",
    )
    await expectDbError(
      () =>
        handle.pool.query(
          "insert into predictions(goal_id, predictor_subject_key, choice, business_key) values ($1, 'other-subject', 'yes', 'prediction:direct-late')",
          [goalId],
        ),
      "PR_PREDICTION_CUTOFF",
    )
  })

  it("keeps terminal and settlement records append-only and bounds uploads", async () => {
    // Given
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    await handle.pool.query(
      "update goals set prediction_cutoff_at = clock_timestamp() where id = $1",
      [goalId],
    )
    // When / Then
    await expectDbError(
      () => handle.pool.query("update goals set goal_copy = 'changed' where id = $1", [goalId]),
      "PR_GOAL_IMMUTABLE",
    )
    await handle.pool.query("select transition_goal($1, 'evidence_open', 'system', null)", [goalId])
    await handle.pool.query("select receive_evidence($1, $2, 'evidence:one')", [goalId, owner])
    await handle.pool.query("select receive_evidence($1, $2, 'evidence:two')", [goalId, owner])
    await expectDbError(
      () => handle.pool.query("select receive_evidence($1, $2, 'evidence:three')", [goalId, owner]),
      "PR_EVIDENCE_ATTEMPTS_EXHAUSTED",
    )
    await handle.pool.query("select transition_goal($1, 'completed', 'system', null)", [goalId])
    await expectDbError(
      () => handle.pool.query("select transition_goal($1, 'failed', 'system', null)", [goalId]),
      "PR_TERMINAL_IMMUTABLE",
    )
    await handle.pool.query(
      "insert into reputation_events(subject_key, business_key, event_kind, points) values ($1, 'goal:completion:v1', 'award', 10)",
      [owner],
    )
    await expect(
      handle.pool.query(
        "insert into reputation_events(subject_key, business_key, event_kind, points) values ($1, 'goal:completion:v1', 'award', 10)",
        [owner],
      ),
    ).rejects.toMatchObject({ code: "23505" })
    await handle.pool.query(
      "select append_goal_correction($1, $2, 'failed', 'operator correction', 'correction:one')",
      [goalId, owner],
    )
    await expectDbError(
      () => handle.pool.query("update goal_correction_events set reason = 'rewritten'"),
      "PR_APPEND_ONLY",
    )
  })

  it("contains only the scoped schema authorities", async () => {
    // Given
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")

    // When
    const result = await handle.pool.query<{ readonly table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    )
    const snapshot = result.rows.map(({ table_name }) => table_name)

    // Then
    expect(snapshot).toEqual(
      expect.arrayContaining([
        "analytics_events",
        "evidence_challenges",
        "evidences",
        "feed_exposures",
        "goals",
        "moderation_cases",
        "predictions",
        "reputation_events",
        "sessions",
        "users",
        "verification_jobs",
      ]),
    )
    expect(snapshot.join(" ")).not.toMatch(/wallet|stake|(^|_)ad(s|_)|pod|recipe_registry/)
  })
})
