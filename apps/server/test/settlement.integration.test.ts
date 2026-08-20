import { randomUUID } from "node:crypto"
import { PgBoss } from "pg-boss"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createVerificationService } from "../src/modules/evidence/verification/service.js"
import {
  dispatchVerificationJobs,
  registerVerificationWorker,
  VERIFICATION_QUEUE,
} from "../src/modules/evidence/verification/worker.js"
import { runGoalLifecycle } from "../src/modules/goals/lifecycle.js"
import { OWNER, SettlementHarness } from "./settlement-test-support.js"

const harness = new SettlementHarness()

async function claimReview() {
  const response = await harness.claim()
  expect(response.statusCode).toBe(200)
  const body = response.json()
  if (typeof body.reviewId !== "string" || typeof body.leaseToken !== "string") {
    throw new TypeError("claim response is malformed")
  }
  return { leaseToken: body.leaseToken, reviewId: body.reviewId }
}

async function reputationTotal(): Promise<number> {
  const result = await harness
    .requireDatabase()
    .pool.query<{ readonly total: string }>(
      "select coalesce(sum(points), 0)::text as total from reputation_events where subject_key = $1",
      [OWNER],
    )
  return Number(result.rows[0]?.total ?? 0)
}

describe("verification-settlement integration", () => {
  beforeAll(async () => harness.start(), 120_000)
  afterAll(async () => harness.stop())
  beforeEach(async () => harness.reset())

  it("atomically completes and awards +10 and strict NO-majority +5", async () => {
    // Given
    const { goalId } = await harness.createEvidence({ choices: ["no"] })
    const claim = await claimReview()

    // When
    const response = await harness.decide(
      claim.reviewId,
      claim.leaseToken,
      { verdict: "accepted" },
      "accepted-once",
    )

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ goalState: "completed", verdict: "accepted" })
    expect(await reputationTotal()).toBe(15)
    const atomic = await harness.requireDatabase().pool.query(
      `select g.state, e.state as verdict, count(distinct v.id)::integer as verdict_events,
         count(distinct a.id)::integer as terminal_events
       from goals g join evidences e on e.goal_id = g.id
       left join evidence_verdict_events v on v.evidence_id = e.id
       left join analytics_events a on a.business_key = 'goal:' || g.id::text || ':terminal:v1'
       where g.id = $1 group by g.state, e.state`,
      [goalId],
    )
    expect(atomic.rows).toEqual([
      { state: "completed", terminal_events: 1, verdict: "accepted", verdict_events: 1 },
    ])
  })

  it.each([
    { choices: [] as const, label: "zero votes" },
    { choices: ["yes", "no"] as const, label: "a tie" },
  ])("awards only completion reputation for $label", async ({ choices }) => {
    // Given
    await harness.createEvidence({ choices })
    const claim = await claimReview()

    // When
    const response = await harness.decide(
      claim.reviewId,
      claim.leaseToken,
      { verdict: "accepted" },
      "accepted-no-crowd-bonus",
    )

    // Then
    expect(response.statusCode).toBe(200)
    expect(await reputationTotal()).toBe(10)
  })

  it("fails without reputation after a final conclusive rejection", async () => {
    // Given
    const { goalId } = await harness.createEvidence({ attemptNumber: 2, choices: ["no"] })
    const claim = await claimReview()

    // When
    const response = await harness.decide(
      claim.reviewId,
      claim.leaseToken,
      { reasonCode: "recipe_mismatch", verdict: "rejected" },
      "final-rejection",
    )

    // Then
    expect(response.json()).toMatchObject({ goalState: "failed", verdict: "rejected" })
    expect(await reputationTotal()).toBe(0)
    expect(
      (
        await harness
          .requireDatabase()
          .pool.query("select state from goals where id = $1", [goalId])
      ).rows,
    ).toEqual([{ state: "failed" }])
  })

  it("keeps an early inconclusive verdict nonterminal for bounded resubmission", async () => {
    // Given
    const { goalId } = await harness.createEvidence()
    const claim = await claimReview()

    // When
    const response = await harness.decide(
      claim.reviewId,
      claim.leaseToken,
      { reasonCode: "image_unreadable", verdict: "inconclusive" },
      "inconclusive-once",
    )

    // Then
    expect(response.json()).toMatchObject({ goalState: "evidence_open" })
    expect(
      (
        await harness
          .requireDatabase()
          .pool.query("select state from goals where id = $1", [goalId])
      ).rows,
    ).toEqual([{ state: "evidence_open" }])
  })

  it("uses the same atomic settlement when the lifecycle scheduler observes acceptance", async () => {
    // Given
    const { evidenceId, goalId } = await harness.createEvidence({ choices: ["no"] })
    const database = harness.requireDatabase()
    await database.pool.query("update evidences set state = 'accepted' where id = $1", [evidenceId])

    // When
    await runGoalLifecycle({ database, now: harness.now })

    // Then
    expect(
      (await database.pool.query("select state from goals where id = $1", [goalId])).rows,
    ).toEqual([{ state: "completed" }])
    expect(await reputationTotal()).toBe(15)
  })

  it("dispatches duplicate receipt jobs through a bounded pg-boss worker", async () => {
    // Given
    const database = harness.requireDatabase()
    const boss = new PgBoss({
      __test__enableSpies: true,
      connectionString: harness.connectionString,
      schema: "pgboss_task10",
    })
    await boss.start()
    try {
      const service = createVerificationService({
        clock: { now: () => new Date(harness.now) },
        database,
        uuid: { create: randomUUID },
      })
      await registerVerificationWorker(boss, database, service)
      const { evidenceId, verificationJobId } = await harness.createEvidence()
      const duplicateJobId = randomUUID()
      await database.pool.query(
        `insert into verification_jobs(id, evidence_id, attempt_number, state, business_key)
         values ($1, $2, 2, 'queued', $3)`,
        [duplicateJobId, evidenceId, `evidence:${evidenceId}:review:2`],
      )
      const spy = boss.getSpy<{ readonly verificationJobId: string }>(VERIFICATION_QUEUE)
      const completed = [verificationJobId, duplicateJobId].map((jobId) =>
        spy.waitForJob(({ verificationJobId: id }) => id === jobId, "completed"),
      )

      // When
      await dispatchVerificationJobs(boss, database)
      const processed = await Promise.all(completed)

      // Then
      expect(processed.map(({ data }) => data.verificationJobId).sort()).toEqual(
        [verificationJobId, duplicateJobId].sort(),
      )
      expect((await database.pool.query("select id from operator_reviews")).rowCount).toBe(1)
      expect(
        (
          await database.pool.query(
            "select id from verification_jobs where state = 'completed' and evidence_id = $1",
            [evidenceId],
          )
        ).rowCount,
      ).toBe(2)
    } finally {
      await boss.stop({ graceful: false })
      await database.pool.query("drop schema if exists pgboss_task10 cascade")
    }
  }, 30_000)
})
