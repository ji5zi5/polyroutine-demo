import { createDatabase, migrateUp } from "@polyroutine/db"
import { startTestPostgres, type TestPostgres } from "@polyroutine/testing"
import fc from "fast-check"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const PROPERTY_SEED = 20_260_819
const PROPERTY_CASES = 1_000

describe("PostgreSQL reputation replay properties", () => {
  let database: ReturnType<typeof createDatabase> | undefined
  let postgres: TestPostgres | undefined

  beforeAll(async () => {
    const { TEST_DATABASE_URL } = process.env
    if (TEST_DATABASE_URL === undefined) {
      postgres = await startTestPostgres()
      database = createDatabase(postgres.connectionString)
    } else {
      database = createDatabase(TEST_DATABASE_URL)
    }
    await migrateUp(database)
  }, 120_000)

  afterAll(async () => {
    if (database !== undefined) await database.destroy()
    if (postgres !== undefined) await postgres.container.stop()
  })

  it("matches first-business-key-wins replay for 1,000 seeded event sequences", async () => {
    // Given
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    let caseNumber = 0
    const sequence = fc.array(
      fc.record({
        businessKey: fc.integer({ max: 15, min: 0 }),
        points: fc.integer({ max: 10, min: -10 }),
      }),
      { maxLength: 30, minLength: 1 },
    )

    // When / Then
    await fc.assert(
      fc.asyncProperty(sequence, async (events) => {
        caseNumber += 1
        const subjectKey = `replay-property-${caseNumber}`
        const expectedByKey = new Map<number, number>()
        for (const event of events) {
          if (!expectedByKey.has(event.businessKey)) {
            expectedByKey.set(event.businessKey, event.points)
          }
        }
        const result = await handle.pool.query<{ readonly score: string }>(
          `with event as (
             select * from jsonb_to_recordset($2::jsonb)
               as row(business_key text, points integer)
           ), inserted as (
             insert into reputation_events(subject_key, business_key, event_kind, points)
             select $1, business_key, 'award', points from event
             on conflict (business_key) do nothing returning points
           ) select coalesce(sum(points), 0)::text as score from inserted`,
          [
            subjectKey,
            JSON.stringify(
              events.map(({ businessKey, points }) => ({
                business_key: `property:${caseNumber}:${businessKey}`,
                points,
              })),
            ),
          ],
        )
        const expected = [...expectedByKey.values()].reduce((score, points) => score + points, 0)
        expect(result.rows).toEqual([{ score: String(expected) }])
      }),
      { endOnFailure: true, numRuns: PROPERTY_CASES, seed: PROPERTY_SEED },
    )
  }, 30_000)
})
