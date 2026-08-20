import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { SettlementHarness } from "./settlement-test-support.js"

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

describe("bounded operator failure handling", () => {
  beforeAll(async () => harness.start(), 120_000)
  afterAll(async () => harness.stop())
  beforeEach(async () => harness.reset())

  it.each([
    { reasonCode: "recipe_mismatch", verdict: "accepted" },
    { claimedAuthentic: true, verdict: "accepted" },
    { verdict: "rejected" },
  ])("rejects malformed or misleading operator payload %#", async (payload) => {
    // Given
    const { evidenceId } = await harness.createEvidence()
    const claim = await claimReview()

    // When
    const response = await harness.decide(
      claim.reviewId,
      claim.leaseToken,
      payload,
      "malformed-decision",
    )

    // Then
    expect(response).toMatchObject({ statusCode: 400 })
    expect(
      (
        await harness
          .requireDatabase()
          .pool.query("select state from evidences where id = $1", [evidenceId])
      ).rows,
    ).toEqual([{ state: "pending" }])
  })

  it("rejects a stale review lease without changing evidence", async () => {
    // Given
    const { evidenceId } = await harness.createEvidence()
    const claim = await claimReview()
    harness.now = new Date(harness.now.getTime() + 15 * 60 * 1_000)

    // When
    const response = await harness.decide(
      claim.reviewId,
      claim.leaseToken,
      { verdict: "accepted" },
      "stale-lease",
    )

    // Then
    expect(response).toMatchObject({ statusCode: 409 })
    expect(response.json()).toMatchObject({ code: "REVIEW_LEASE_STALE" })
    expect(
      (
        await harness
          .requireDatabase()
          .pool.query("select state from evidences where id = $1", [evidenceId])
      ).rows,
    ).toEqual([{ state: "pending" }])
  })

  it("expires after the third operator lease ends beyond processing grace", async () => {
    // Given
    const deadline = new Date(harness.now.getTime() + 60 * 60 * 1_000)
    const { goalId } = await harness.createEvidence({ deadline })
    const claim = await claimReview()
    await harness.requireDatabase().pool.query(
      `update operator_reviews set lease_attempts = 3,
         lease_expires_at = $1 where id = $2`,
      [new Date(deadline.getTime() + 15 * 60 * 1_000), claim.reviewId],
    )
    harness.now = new Date(deadline.getTime() + 15 * 60 * 1_000)

    // When
    const response = await harness.claim()

    // Then
    expect(response.statusCode).toBe(204)
    expect(
      (
        await harness
          .requireDatabase()
          .pool.query("select state from goals where id = $1", [goalId])
      ).rows,
    ).toEqual([{ state: "expired" }])
  })

  it("holds the queue cap under concurrent claims without disguising saturation", async () => {
    // Given
    await harness.createEvidence()
    await harness.createEvidence({ owner: "second-settlement-owner" })

    // When
    const responses = await Promise.all([harness.claim(), harness.claim("second-operator")])

    // Then
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 503])
    expect(responses.find(({ statusCode }) => statusCode === 503)?.json()).toMatchObject({
      code: "OPERATOR_QUEUE_SATURATED",
    })
    const database = harness.requireDatabase()
    expect((await database.pool.query("select id from operator_reviews")).rowCount).toBe(1)
    expect((await database.pool.query("select state from evidences order by id")).rows).toEqual([
      { state: "pending" },
      { state: "pending" },
    ])
  })

  it("rolls back verdict, terminal, reputation, and event on interruption", async () => {
    // Given
    const { evidenceId, goalId } = await harness.createEvidence()
    const claim = await claimReview()
    const database = harness.requireDatabase()
    await database.pool.query(`create function task10_interrupt() returns trigger language plpgsql as $$
      begin raise exception 'task10 interruption'; end $$`)
    await database.pool.query(`create trigger task10_interrupt before insert on reputation_events
      for each row execute function task10_interrupt()`)

    // When
    const response = await harness
      .decide(claim.reviewId, claim.leaseToken, { verdict: "accepted" }, "interrupted-once")
      .finally(async () => {
        await database.pool.query("drop trigger if exists task10_interrupt on reputation_events")
        await database.pool.query("drop function if exists task10_interrupt()")
      })

    // Then
    expect(response.statusCode).toBe(500)
    const states = await database.pool.query(
      `select g.state as goal_state, e.state as evidence_state
       from goals g join evidences e on e.goal_id = g.id where g.id = $1 and e.id = $2`,
      [goalId, evidenceId],
    )
    expect(states.rows).toEqual([{ evidence_state: "pending", goal_state: "evidence_open" }])
    expect((await database.pool.query("select id from reputation_events")).rowCount).toBe(0)
    expect((await database.pool.query("select id from evidence_verdict_events")).rowCount).toBe(0)
  })
})
