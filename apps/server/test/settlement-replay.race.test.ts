import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { OWNER, SettlementHarness } from "./settlement-test-support.js"

const harness = new SettlementHarness()

async function acceptedFixture() {
  const { goalId } = await harness.createEvidence({ choices: ["no"] })
  const claimResponse = await harness.claim()
  const claim = claimResponse.json()
  if (typeof claim.reviewId !== "string" || typeof claim.leaseToken !== "string") {
    throw new TypeError("claim response is malformed")
  }
  return { goalId, leaseToken: claim.leaseToken, reviewId: claim.reviewId }
}

function correctionRequest(goalId: string, correctedState = "failed", reason = "wrong verdict") {
  return harness.requireServer().inject({
    body: { correctedState, reason },
    headers: {
      "idempotency-key": "correction-replay",
      "x-operator-subject-key": "correction-operator",
    },
    method: "POST",
    url: `/v1/operator/goals/${goalId}/corrections`,
  })
}

describe("settlement replay races", () => {
  beforeAll(async () => harness.start(), 120_000)
  afterAll(async () => harness.stop())
  beforeEach(async () => harness.reset())

  it("settles 100 duplicate operator callbacks exactly once", async () => {
    // Given
    const fixture = await acceptedFixture()

    // When
    const responses = await Promise.all(
      Array.from({ length: 100 }, () =>
        harness.decide(
          fixture.reviewId,
          fixture.leaseToken,
          { verdict: "accepted" },
          "same-callback",
        ),
      ),
    )

    // Then
    expect(responses.every(({ statusCode }) => statusCode === 200)).toBe(true)
    expect(responses.filter(({ json }) => json().replayed === false)).toHaveLength(1)
    expect(responses.filter(({ json }) => json().replayed === true)).toHaveLength(99)
    const counts = await harness.requireDatabase().pool.query<{
      readonly reputation: string
      readonly score: string
      readonly terminals: string
      readonly verdicts: string
    }>(
      `select (select count(*)::text from evidence_verdict_events) as verdicts,
         (select count(*)::text from reputation_events) as reputation,
         (select count(*)::text from analytics_events where event_name = 'goal_terminal') as terminals,
         (select sum(points)::text from reputation_events where subject_key = $1) as score`,
      [OWNER],
    )
    expect(counts.rows).toEqual([{ reputation: "2", score: "15", terminals: "1", verdicts: "1" }])
  })

  it("applies 100 duplicate corrections as one append-only inverse", async () => {
    // Given
    const fixture = await acceptedFixture()
    const accepted = await harness.decide(
      fixture.reviewId,
      fixture.leaseToken,
      { verdict: "accepted" },
      "accepted-before-correction",
    )
    expect(accepted.statusCode).toBe(200)

    // When
    const responses = await Promise.all(
      Array.from({ length: 100 }, () => correctionRequest(fixture.goalId)),
    )

    // Then
    expect(responses.every(({ statusCode }) => statusCode === 200)).toBe(true)
    expect(responses.filter(({ json }) => json().replayed === false)).toHaveLength(1)
    expect(responses.filter(({ json }) => json().replayed === true)).toHaveLength(99)
    const ledger = await harness.requireDatabase().pool.query<{
      readonly corrections: string
      readonly events: string
      readonly score: string
    }>(
      `select (select count(*)::text from goal_correction_events) as corrections,
         count(*)::text as events, sum(points)::text as score
       from reputation_events where subject_key = $1`,
      [OWNER],
    )
    expect(ledger.rows).toEqual([{ corrections: "1", events: "4", score: "0" }])
  })

  it("rejects a changed correction replay without changing derived score", async () => {
    // Given
    const fixture = await acceptedFixture()
    await harness.decide(
      fixture.reviewId,
      fixture.leaseToken,
      { verdict: "accepted" },
      "accepted-before-conflict",
    )
    await correctionRequest(fixture.goalId)

    // When
    const response = await correctionRequest(fixture.goalId, "completed", "changed replay")

    // Then
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ code: "CORRECTION_CONFLICT" })
    const score = await harness
      .requireDatabase()
      .pool.query<{ readonly score: string }>(
        "select sum(points)::text as score from reputation_events where subject_key = $1",
        [OWNER],
      )
    expect(score.rows).toEqual([{ score: "0" }])
  })

  it("replays 1,000 permuted duplicate business keys to the same score", async () => {
    // Given
    const events = Array.from({ length: 1_000 }, (_, index) => ({
      businessKey: `property:${index}`,
      points: (index % 21) - 10,
    }))
    const replay = [...events, ...events].sort((left, right) =>
      `${left.businessKey}:seed-20260819`.localeCompare(`${right.businessKey}:seed-20260819`),
    )

    // When
    await harness.requireDatabase().pool.query(
      `insert into reputation_events(subject_key, business_key, event_kind, points)
       select $1, event.business_key, 'award', event.points
       from jsonb_to_recordset($2::jsonb) as event(business_key text, points integer)
       on conflict (business_key) do nothing`,
      [
        OWNER,
        JSON.stringify(
          replay.map(({ businessKey, points }) => ({ business_key: businessKey, points })),
        ),
      ],
    )

    // Then
    const total = await harness
      .requireDatabase()
      .pool.query<{ readonly score: string }>(
        "select sum(points)::text as score from reputation_events where subject_key = $1",
        [OWNER],
      )
    expect(total.rows).toEqual([
      { score: String(events.reduce((score, event) => score + event.points, 0)) },
    ])
  })
})
