import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { EvidenceHarness, OWNER } from "./evidence-ingest-test-support.js"
import "./moderation-retention-adversarial.integration.js"

const REVIEWER = "reviewer-one"
const OTHER_REVIEWER = "reviewer-two"
const RETENTION_OPERATOR = "retention-operator"
const harness = new EvidenceHarness()

async function post(path: string, body: unknown, operator = REVIEWER) {
  return harness.sendJson(path, body, { "x-operator-key": operator })
}

describe("moderation-retention integration", () => {
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

  it("reports, exclusively claims, audits short-lived access, resolves, and corrects a case", async () => {
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)
    const uploaded = await harness.upload(goalId, { challengeCode: code })
    const evidenceId = String(uploaded.body.receipt_id)

    const report = await harness.sendJson(
      "/v1/moderation/reports",
      { reasonCode: "prohibited_content", targetId: evidenceId, targetType: "evidence" },
      { "x-subject-key": OWNER },
    )
    const caseId = String(report.body.case_id)
    expect(report).toMatchObject({ statusCode: 201, body: { state: "reported" } })

    expect(await post(`/operator/cases/${caseId}/claim`, {})).toMatchObject({
      statusCode: 200,
      body: { claimed_by: REVIEWER },
    })
    expect(await post(`/operator/cases/${caseId}/claim`, {}, OTHER_REVIEWER)).toMatchObject({
      statusCode: 409,
      body: { code: "CASE_ALREADY_CLAIMED" },
    })
    const access = await post(`/operator/cases/${caseId}/access`, {})
    expect(access).toMatchObject({ statusCode: 200 })
    expect(access.body.url).toMatch(/^https:\/\/objects\.test\/signed\//)

    expect(
      await post(`/operator/cases/${caseId}/resolve`, {
        idempotencyKey: "resolve-1",
        reason: "guided recipe is visible",
        verdict: "accepted",
      }),
    ).toMatchObject({ statusCode: 200, body: { verdict: "accepted" } })
    const repeatedReport = await harness.sendJson(
      "/v1/moderation/reports",
      { reasonCode: "personal_data", targetId: evidenceId, targetType: "evidence" },
      { "x-subject-key": OWNER },
    )
    expect(repeatedReport).toMatchObject({
      statusCode: 201,
      body: { case_id: caseId, state: "reported" },
    })
    expect(await post(`/operator/cases/${caseId}/claim`, {})).toMatchObject({ statusCode: 200 })
    expect(
      await post(`/operator/cases/${caseId}/resolve`, {
        idempotencyKey: "resolve-2",
        reason: "repeat report reviewed",
        verdict: "accepted",
      }),
    ).toMatchObject({ statusCode: 200, body: { verdict: "accepted" } })
    expect(
      await post(`/operator/evidences/${evidenceId}/corrections`, {
        idempotencyKey: "correction-1",
        reason: "second review found ambiguity",
        verdict: "inconclusive",
      }),
    ).toMatchObject({ statusCode: 200, body: { verdict: "inconclusive" } })
    expect(
      await post(`/operator/evidences/${evidenceId}/corrections`, {
        idempotencyKey: "correction-2",
        reason: "final review found prohibited content",
        verdict: "rejected",
      }),
    ).toMatchObject({ statusCode: 200, body: { verdict: "rejected" } })
    expect(
      await post(`/operator/goals/${goalId}/cancel`, {
        idempotencyKey: "cancel-1",
        reason: "prohibited evidence",
      }),
    ).toMatchObject({ statusCode: 200, body: { state: "cancelled" } })

    const rows = await harness.requireDatabase().pool.query(
      `select
         (select count(*)::int from moderation_access_audits) as accesses,
         (select count(*)::int from evidence_verdict_events) as verdict_events,
         (select count(*)::int from goal_correction_events where goal_id = $1) as goal_corrections,
         (select state from evidences where id = $2) as evidence_state`,
      [goalId, evidenceId],
    )
    expect(rows.rows[0]).toEqual({
      accesses: 1,
      evidence_state: "rejected",
      goal_corrections: 1,
      verdict_events: 4,
    })
  })

  it("keeps a goal report to one claimable, idempotently resolvable case", async () => {
    const goalId = await harness.createGoal()
    const reportBody = { reasonCode: "other", targetId: goalId, targetType: "goal" }
    const first = await harness.sendJson("/v1/moderation/reports", reportBody, {
      "x-subject-key": OWNER,
    })
    const repeated = await harness.sendJson("/v1/moderation/reports", reportBody, {
      "x-subject-key": OWNER,
    })
    const caseId = String(first.body.case_id)
    expect(first).toMatchObject({ statusCode: 201, body: { state: "reported" } })
    expect(repeated).toMatchObject({ statusCode: 201, body: { case_id: caseId } })
    expect(await post(`/operator/cases/${caseId}/claim`, {})).toMatchObject({ statusCode: 200 })

    const decision = {
      idempotencyKey: "goal-resolution-1",
      reason: "goal copy is allowed",
      verdict: "accepted",
    }
    expect(await post(`/operator/cases/${caseId}/resolve`, decision)).toMatchObject({
      statusCode: 200,
      body: { verdict: "accepted" },
    })
    expect(await post(`/operator/cases/${caseId}/resolve`, decision)).toMatchObject({
      statusCode: 200,
      body: { verdict: "accepted" },
    })
    expect(
      await harness
        .requireDatabase()
        .pool.query(
          "select count(*)::int as count, bool_and(resolved_at is not null) as resolved from moderation_cases where goal_id = $1 and evidence_id is null",
          [goalId],
        ),
    ).toMatchObject({ rows: [{ count: 1, resolved: true }] })
  })

  it("denies ordinary users, non-claimants, and expired signed URLs", async () => {
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)
    const uploaded = await harness.upload(goalId, { challengeCode: code })
    const evidenceId = String(uploaded.body.receipt_id)
    const cases = await harness
      .requireDatabase()
      .pool.query("select id::text from moderation_cases where evidence_id = $1", [evidenceId])
    const caseId = String(cases.rows[0]?.id)

    expect(await harness.sendJson(`/operator/cases/${caseId}/claim`, {}, {})).toMatchObject({
      statusCode: 401,
    })
    await post(`/operator/cases/${caseId}/claim`, {})
    expect(await post(`/operator/cases/${caseId}/access`, {}, OTHER_REVIEWER)).toMatchObject({
      statusCode: 403,
      body: { code: "CASE_ACCESS_DENIED" },
    })
    const access = await post(`/operator/cases/${caseId}/access`, {})
    harness.now = new Date(harness.now.getTime() + 5 * 60 * 1_000 + 1)
    expect(harness.store.isSignedUrlValid(String(access.body.url), harness.now)).toBe(false)
    harness.now = new Date(harness.now.getTime() + 10 * 60 * 1_000)
    expect(await post(`/operator/cases/${caseId}/claim`, {}, OTHER_REVIEWER)).toMatchObject({
      statusCode: 200,
      body: { claimed_by: OTHER_REVIEWER },
    })
    expect(await post(`/operator/cases/${caseId}/access`, {})).toMatchObject({
      statusCode: 403,
      body: { code: "CASE_ACCESS_DENIED" },
    })
  })

  it("deletes terminal bytes at 24h, bounds pending bytes at 7d, and purges metadata at 90d", async () => {
    const terminalGoal = await harness.createGoal()
    const terminalCode = await harness.challenge(terminalGoal)
    const terminal = await harness.upload(terminalGoal, { challengeCode: terminalCode })
    const pendingGoal = await harness.createGoal({ owner: "other-owner" })
    const pendingCode = await harness.challenge(pendingGoal, "other-owner")
    await harness.upload(pendingGoal, { challengeCode: pendingCode, owner: "other-owner" })
    await harness
      .requireDatabase()
      .pool.query(`update evidences set state = 'accepted', resolved_at = $2 where id = $1`, [
        terminal.body.receipt_id,
        harness.now,
      ])

    harness.now = new Date(harness.now.getTime() + 24 * 60 * 60 * 1_000 - 1)
    expect(await post("/operator/retention/run", {}, RETENTION_OPERATOR)).toMatchObject({
      statusCode: 200,
      body: { deleted: 0 },
    })
    harness.now = new Date(harness.now.getTime() + 2)
    expect(await post("/operator/retention/run", {}, RETENTION_OPERATOR)).toMatchObject({
      statusCode: 200,
      body: { deleted: 1 },
    })
    expect(harness.store.objects.size).toBe(1)

    harness.now = new Date("2026-08-26T01:00:00.001Z")
    expect(await post("/operator/retention/run", {}, RETENTION_OPERATOR)).toMatchObject({
      statusCode: 200,
      body: { deleted: 1 },
    })
    expect(harness.store.objects.size).toBe(0)

    harness.now = new Date("2026-11-24T01:00:00.002Z")
    expect(await post("/operator/retention/run", {}, RETENTION_OPERATOR)).toMatchObject({
      statusCode: 200,
      body: { purged: 2 },
    })
    const uploads = await harness
      .requireDatabase()
      .pool.query(
        "select object_key, sha256, metadata_purged_at is not null as purged from evidence_uploads order by evidence_id",
      )
    expect(uploads.rows).toEqual([
      { object_key: null, purged: true, sha256: null },
      { object_key: null, purged: true, sha256: null },
    ])
  })

  it("retains reported terminal evidence for review but deletes it by the seven-day bound", async () => {
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)
    const uploaded = await harness.upload(goalId, { challengeCode: code })
    const evidenceId = String(uploaded.body.receipt_id)
    await harness
      .requireDatabase()
      .pool.query("update evidences set state = 'accepted', resolved_at = $2 where id = $1", [
        evidenceId,
        harness.now,
      ])
    expect(
      await harness.sendJson(
        "/v1/moderation/reports",
        { reasonCode: "prohibited_content", targetId: evidenceId, targetType: "evidence" },
        { "x-subject-key": OWNER },
      ),
    ).toMatchObject({ statusCode: 201 })

    harness.now = new Date(harness.now.getTime() + 24 * 60 * 60 * 1_000)
    expect(await post("/operator/retention/run", {}, RETENTION_OPERATOR)).toMatchObject({
      statusCode: 200,
      body: { deleted: 0 },
    })
    expect(harness.store.objects.size).toBe(1)

    harness.now = new Date("2026-08-26T01:00:00.000Z")
    expect(await post("/operator/retention/run", {}, RETENTION_OPERATOR)).toMatchObject({
      statusCode: 200,
      body: { deleted: 1 },
    })
    expect(harness.store.objects.size).toBe(0)
  })

  it("retries object deletion, dead-letters after three attempts, and emits an alert", async () => {
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)
    const uploaded = await harness.upload(goalId, { challengeCode: code })
    await harness
      .requireDatabase()
      .pool.query("update evidences set state = 'rejected', resolved_at = $2 where id = $1", [
        uploaded.body.receipt_id,
        harness.now,
      ])
    harness.store.failDelete = true
    harness.now = new Date(harness.now.getTime() + 24 * 60 * 60 * 1_000)

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await post("/operator/retention/run", {}, RETENTION_OPERATOR)
      expect(response.statusCode).toBe(200)
      harness.now = new Date(harness.now.getTime() + 60 * 60 * 1_000)
    }
    expect(
      await harness
        .requireDatabase()
        .pool.query("select state, attempt_count from object_deletion_jobs"),
    ).toMatchObject({ rows: [{ attempt_count: 3, state: "dead_letter" }] })
    expect(
      await harness.requireDatabase().pool.query("select alert_kind from operator_alerts"),
    ).toMatchObject({ rows: [{ alert_kind: "object_delete_dead_letter" }] })
  })

  it("routes account deletion image jobs through the same deletion queue", async () => {
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)
    await harness.upload(goalId, { challengeCode: code })
    const accountJobId = randomUUID()
    await harness.requireDatabase().pool.query(
      `insert into account_deletion_jobs(id, tombstone_subject_key, job_kind, goal_ids)
       values ($1, $2, 'delete_account_images', $3::jsonb)`,
      [accountJobId, OWNER, JSON.stringify([goalId])],
    )

    const response = await post("/operator/retention/run", {}, RETENTION_OPERATOR)
    expect(response).toMatchObject({ statusCode: 200, body: { deleted: 1 } })
    expect(harness.store.objects.size).toBe(0)
    expect(
      await harness
        .requireDatabase()
        .pool.query(
          "select state, completed_at is not null as completed from account_deletion_jobs where id = $1",
          [accountJobId],
        ),
    ).toMatchObject({ rows: [{ completed: true, state: "completed" }] })
  })
})
