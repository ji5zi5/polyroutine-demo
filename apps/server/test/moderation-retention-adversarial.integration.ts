import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { EvidenceHarness, OWNER } from "./evidence-ingest-test-support.js"

const REVIEWER = "adversarial-reviewer"
const OTHER_REVIEWER = "adversarial-reviewer-two"
const RETENTION_OPERATOR = "adversarial-retention"
const harness = new EvidenceHarness({ queueLimit: 1 })

async function post(path: string, body: unknown, operator = REVIEWER) {
  return harness.sendJson(path, body, { "x-operator-key": operator })
}

describe("moderation-retention adversarial integration", () => {
  beforeAll(async () => harness.start(), 120_000)
  afterAll(async () => harness.stop())
  beforeEach(async () => {
    await harness.reset()
    await harness.requireDatabase().pool.query(
      `insert into operator_roles(subject_key, role) values
       ($1, 'case_reviewer'), ($2, 'case_reviewer'), ($3, 'retention_operator')`,
      [REVIEWER, OTHER_REVIEWER, RETENTION_OPERATOR],
    )
  })

  it("rejects malformed reports without creating a case", async () => {
    // Given
    const goalId = await harness.createGoal()

    // When
    const response = await harness.sendJson(
      "/v1/moderation/reports",
      { reasonCode: "unsupported", targetId: goalId, targetType: "goal" },
      { "x-subject-key": OWNER },
    )

    // Then
    expect(response).toMatchObject({ statusCode: 400, body: { code: "INVALID_REPORT" } })
    await expect(
      harness.requireDatabase().pool.query("select id from moderation_cases"),
    ).resolves.toMatchObject({ rowCount: 0 })
  })

  it("rejects a new report when the bounded review queue is saturated", async () => {
    // Given
    const firstGoalId = await harness.createGoal()
    const secondGoalId = await harness.createGoal({ owner: "other-owner" })
    await harness.sendJson(
      "/v1/moderation/reports",
      { reasonCode: "other", targetId: firstGoalId, targetType: "goal" },
      { "x-subject-key": OWNER },
    )

    // When
    const response = await harness.sendJson(
      "/v1/moderation/reports",
      { reasonCode: "other", targetId: secondGoalId, targetType: "goal" },
      { "x-subject-key": OWNER },
    )

    // Then
    expect(response).toMatchObject({ statusCode: 503, body: { code: "QUEUE_SATURATED" } })
    await expect(
      harness.requireDatabase().pool.query("select id from moderation_cases"),
    ).resolves.toMatchObject({ rowCount: 1 })
  })

  it("denies resolution after the claim lease becomes stale", async () => {
    // Given
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)
    const uploaded = await harness.upload(goalId, { challengeCode: code })
    const evidenceId = String(uploaded.body.receipt_id)
    const report = await harness.sendJson(
      "/v1/moderation/reports",
      { reasonCode: "other", targetId: evidenceId, targetType: "evidence" },
      { "x-subject-key": OWNER },
    )
    const caseId = String(report.body.case_id)
    await post(`/operator/cases/${caseId}/claim`, {})
    harness.now = new Date(harness.now.getTime() + 15 * 60 * 1_000 + 1)

    // When
    const response = await post(`/operator/cases/${caseId}/resolve`, {
      idempotencyKey: "stale-resolution",
      reason: "lease already expired",
      verdict: "rejected",
    })

    // Then
    expect(response).toMatchObject({ statusCode: 403, body: { code: "CASE_ACCESS_DENIED" } })
  })

  it("converges an interrupted account deletion after the object is already absent", async () => {
    // Given
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)
    const uploaded = await harness.upload(goalId, { challengeCode: code })
    const evidenceId = String(uploaded.body.receipt_id)
    const accountJobId = randomUUID()
    await harness.requireDatabase().pool.query(
      `insert into account_deletion_jobs(id, tombstone_subject_key, job_kind, goal_ids)
       values ($1, $2, 'delete_account_images', $3::jsonb)`,
      [accountJobId, OWNER, JSON.stringify([goalId])],
    )
    await harness.requireDatabase().pool.query(
      `insert into object_deletion_jobs(
         id, evidence_id, source, state, next_attempt_at, locked_at, created_at
       ) values ($1, $2, 'account_deletion', 'running', $3, $4, $3)`,
      [randomUUID(), evidenceId, harness.now, new Date(harness.now.getTime() - 16 * 60 * 1_000)],
    )
    harness.store.objects.clear()

    // When
    const response = await post("/operator/retention/run", {}, RETENTION_OPERATOR)

    // Then
    expect(response).toMatchObject({ statusCode: 200, body: { deleted: 1 } })
    await expect(
      harness.requireDatabase().pool.query(
        `select a.state as account_state, u.object_key
         from account_deletion_jobs a
         join evidences e on a.goal_ids ? e.goal_id::text
         join evidence_uploads u on u.evidence_id = e.id
         where a.id = $1`,
        [accountJobId],
      ),
    ).resolves.toMatchObject({ rows: [{ account_state: "completed", object_key: null }] })
  })

  it("keeps corrections append-only after an operator changes a verdict", async () => {
    // Given
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)
    const uploaded = await harness.upload(goalId, { challengeCode: code })
    const evidenceId = String(uploaded.body.receipt_id)
    const report = await harness.sendJson(
      "/v1/moderation/reports",
      { reasonCode: "other", targetId: evidenceId, targetType: "evidence" },
      { "x-subject-key": OWNER },
    )
    const caseId = String(report.body.case_id)
    await post(`/operator/cases/${caseId}/claim`, {})
    await post(`/operator/cases/${caseId}/resolve`, {
      idempotencyKey: "initial-verdict",
      reason: "initial review",
      verdict: "accepted",
    })

    // When
    const correction = await post(`/operator/evidences/${evidenceId}/corrections`, {
      idempotencyKey: "append-only-correction",
      reason: "new evidence changes the outcome",
      verdict: "rejected",
    })

    // Then
    expect(correction).toMatchObject({ statusCode: 200, body: { verdict: "rejected" } })
    await expect(
      harness
        .requireDatabase()
        .pool.query(
          "update evidence_verdict_events set reason = 'rewritten' where evidence_id = $1",
          [evidenceId],
        ),
    ).rejects.toThrow()
    await expect(
      harness
        .requireDatabase()
        .pool.query(
          "select event_kind, verdict from evidence_verdict_events where evidence_id = $1 order by created_at",
          [evidenceId],
        ),
    ).resolves.toMatchObject({
      rows: [
        { event_kind: "decision", verdict: "accepted" },
        { event_kind: "correction", verdict: "rejected" },
      ],
    })
  })
})
