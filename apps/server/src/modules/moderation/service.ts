import { createHash } from "node:crypto"
import type {
  Clock,
  EvidenceObjectKey,
  EvidenceObjectStore,
  UuidFactory,
} from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"

const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1_000
const SIGNED_URL_TTL_MS = 5 * 60 * 1_000
const DEFAULT_CLAIM_LEASE_MS = 15 * 60 * 1_000
const DEFAULT_REVIEW_SLA_MS = 24 * 60 * 60 * 1_000
const MAX_DELETE_ATTEMPTS = 3

export type EvidenceUrlSigner = {
  signRead(key: EvidenceObjectKey, expiresAt: Date): Promise<string>
}

type ModerationOptions = {
  readonly claimLeaseMs?: number
  readonly clock: Clock
  readonly database: DatabaseHandle
  readonly objectStore: EvidenceObjectStore
  readonly signer: EvidenceUrlSigner
  readonly uuid: UuidFactory
  readonly queueLimit?: number
  readonly reviewSlaMs?: number
}

type Verdict = "accepted" | "rejected" | "inconclusive"
type Role = "case_reviewer" | "retention_operator"

export class ModerationError extends Error {
  override readonly name = "ModerationError"

  constructor(
    readonly code:
      | "CASE_ACCESS_DENIED"
      | "CASE_ALREADY_CLAIMED"
      | "CASE_ALREADY_RESOLVED"
      | "CASE_NOT_FOUND"
      | "EVIDENCE_NOT_FOUND"
      | "GOAL_NOT_FOUND"
      | "OPERATOR_REQUIRED"
      | "QUEUE_SATURATED"
      | "REPORT_TARGET_NOT_FOUND",
    readonly statusCode: 401 | 403 | 404 | 409 | 503,
  ) {
    super(code)
  }
}

function plus(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds)
}

export function createModerationService(options: ModerationOptions) {
  const claimLeaseMs = options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS
  const queueLimit = options.queueLimit ?? 100
  const reviewSlaMs = options.reviewSlaMs ?? DEFAULT_REVIEW_SLA_MS

  async function requireRole(subjectKey: string | undefined, role: Role): Promise<string> {
    if (subjectKey === undefined) throw new ModerationError("OPERATOR_REQUIRED", 401)
    const roleRow = await options.database.pool.query(
      "select 1 from operator_roles where subject_key = $1 and role = $2",
      [subjectKey, role],
    )
    if (roleRow.rowCount !== 1) throw new ModerationError("OPERATOR_REQUIRED", 403)
    return subjectKey
  }

  async function appendVerdict(input: {
    readonly businessKey: string
    readonly evidenceId: string
    readonly operator: string
    readonly reason: string
    readonly verdict: Verdict
    readonly requireClaimedCase: boolean
  }): Promise<Verdict> {
    const now = options.clock.now()
    const client = await options.database.pool.connect()
    await client.query("begin")
    try {
      const replay = await client.query<{ readonly verdict: Verdict }>(
        "select verdict from evidence_verdict_events where business_key = $1",
        [input.businessKey],
      )
      if (replay.rows[0] !== undefined) {
        await client.query("commit")
        return replay.rows[0].verdict
      }
      const evidence = await client.query<{ readonly state: string }>(
        "select state from evidences where id = $1 for update",
        [input.evidenceId],
      )
      const previous = evidence.rows[0]?.state
      if (previous === undefined) throw new ModerationError("EVIDENCE_NOT_FOUND", 404)
      if (input.requireClaimedCase) {
        const claimed = await client.query(
          `select 1 from moderation_cases where evidence_id = $1 and claimed_by = $2
             and claim_expires_at > $3 and resolved_at is null for update`,
          [input.evidenceId, input.operator, now],
        )
        if (claimed.rowCount !== 1) throw new ModerationError("CASE_ACCESS_DENIED", 403)
      }
      const previousVerdict = ["accepted", "rejected", "inconclusive"].includes(previous)
        ? previous
        : null
      await client.query(
        `insert into evidence_verdict_events(
           id, evidence_id, operator_subject_key, event_kind, previous_verdict, verdict,
           reason, business_key, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          options.uuid.create(),
          input.evidenceId,
          input.operator,
          previousVerdict === null ? "decision" : "correction",
          previousVerdict,
          input.verdict,
          input.reason,
          input.businessKey,
          now,
        ],
      )
      await client.query("update evidences set state = $2, resolved_at = $3 where id = $1", [
        input.evidenceId,
        input.verdict,
        now,
      ])
      if (input.requireClaimedCase) {
        await client.query(
          `update moderation_cases set state = case when $2 = 'accepted' then 'clear' else 'removed' end,
             verdict = $2, resolution_reason = $3, resolved_at = $4
           where evidence_id = $1`,
          [input.evidenceId, input.verdict, input.reason, now],
        )
      }
      await client.query("commit")
      return input.verdict
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  }

  return {
    policy: async () => ({
      adultSelfAttestationIsNotAgeVerification: true as const,
      evidenceAccess: "case_scoped_short_lived_operator_access" as const,
      prohibitedContent: ["sexual_content", "violence", "personal_data", "malware"] as const,
      retention: {
        pendingOrReportedHours: 168 as const,
        terminalHours: 24 as const,
        tombstoneDays: 90 as const,
      },
    }),

    report: async (
      reporter: string,
      input: {
        readonly reasonCode: string
        readonly targetId: string
        readonly targetType: "evidence" | "goal"
      },
    ) => {
      const now = options.clock.now()
      const client = await options.database.pool.connect()
      await client.query("begin")
      try {
        await client.query("select pg_advisory_xact_lock(hashtext('moderation-report-queue'))")
        if (input.targetType === "evidence") {
          const target = await client.query<{
            readonly id: string
            readonly resolved_at: Date | null
          }>(
            "select id::text, resolved_at from moderation_cases where evidence_id = $1 for update",
            [input.targetId],
          )
          const row = target.rows[0]
          if (row === undefined) throw new ModerationError("REPORT_TARGET_NOT_FOUND", 404)
          if (row.resolved_at !== null) {
            const open = await client.query(
              "select count(*)::int as count from moderation_cases where resolved_at is null",
            )
            if ((open.rows[0]?.count ?? 0) >= queueLimit)
              throw new ModerationError("QUEUE_SATURATED", 503)
          }
          await client.query(
            `update moderation_cases set state = 'reported', reporter_subject_key = $2,
               report_reason_code = $3, review_due_at = least(created_at + interval '7 days', $4),
               claimed_by = case when resolved_at is null then claimed_by else null end,
               claim_expires_at = case when resolved_at is null then claim_expires_at else null end,
               resolved_at = null, resolution_reason = null, resolution_business_key = null, verdict = null
             where id = $1`,
            [row.id, reporter, input.reasonCode, plus(now, reviewSlaMs)],
          )
          await client.query("commit")
          return { caseId: row.id, state: "reported" as const }
        }
        const target = await client.query("select 1 from goals where id = $1", [input.targetId])
        if (target.rowCount !== 1) throw new ModerationError("REPORT_TARGET_NOT_FOUND", 404)
        const existing = await client.query<{ readonly id: string }>(
          `select id::text from moderation_cases
           where goal_id = $1 and evidence_id is null and resolved_at is null for update`,
          [input.targetId],
        )
        const existingId = existing.rows[0]?.id
        if (existingId !== undefined) {
          await client.query(
            `update moderation_cases set reporter_subject_key = $2, report_reason_code = $3,
               review_due_at = least(created_at + interval '7 days', $4) where id = $1`,
            [existingId, reporter, input.reasonCode, plus(now, reviewSlaMs)],
          )
          await client.query("commit")
          return { caseId: existingId, state: "reported" as const }
        }
        const open = await client.query(
          "select count(*)::int as count from moderation_cases where resolved_at is null",
        )
        if ((open.rows[0]?.count ?? 0) >= queueLimit)
          throw new ModerationError("QUEUE_SATURATED", 503)
        const caseId = options.uuid.create()
        await client.query(
          `insert into moderation_cases(
             id, goal_id, state, reason, reporter_subject_key, report_reason_code, created_at, review_due_at
           ) values ($1, $2, 'reported', 'user_report', $3, $4, $5, $6)`,
          [caseId, input.targetId, reporter, input.reasonCode, now, plus(now, reviewSlaMs)],
        )
        await client.query("commit")
        return { caseId, state: "reported" as const }
      } catch (error) {
        await client.query("rollback")
        throw error
      } finally {
        client.release()
      }
    },

    claim: async (operatorKey: string | undefined, caseId: string) => {
      const operator = await requireRole(operatorKey, "case_reviewer")
      const now = options.clock.now()
      const result = await options.database.pool.query<{
        readonly claimed_by: string
        readonly claim_expires_at: Date
      }>(
        `update moderation_cases set claimed_by = $2, claim_expires_at = $3,
           review_due_at = least(coalesce(review_due_at, $4), $4)
         where id = $1 and resolved_at is null
           and (claimed_by is null or claim_expires_at <= $5 or claimed_by = $2)
         returning claimed_by, claim_expires_at`,
        [caseId, operator, plus(now, claimLeaseMs), plus(now, reviewSlaMs), now],
      )
      if (result.rows[0] !== undefined) {
        return {
          claimedBy: result.rows[0].claimed_by,
          leaseExpiresAt: result.rows[0].claim_expires_at.toISOString(),
        }
      }
      const exists = await options.database.pool.query(
        "select 1 from moderation_cases where id = $1",
        [caseId],
      )
      if (exists.rowCount !== 1) throw new ModerationError("CASE_NOT_FOUND", 404)
      throw new ModerationError("CASE_ALREADY_CLAIMED", 409)
    },

    access: async (operatorKey: string | undefined, caseId: string) => {
      const operator = await requireRole(operatorKey, "case_reviewer")
      const now = options.clock.now()
      const result = await options.database.pool.query<{ readonly object_key: string }>(
        `select u.object_key from moderation_cases m
         join evidence_uploads u on u.evidence_id = m.evidence_id
         where m.id = $1 and m.claimed_by = $2 and m.claim_expires_at > $3
           and m.resolved_at is null and u.object_key is not null`,
        [caseId, operator, now],
      )
      const rawKey = result.rows[0]?.object_key
      if (rawKey === undefined) throw new ModerationError("CASE_ACCESS_DENIED", 403)
      const key = rawKey as EvidenceObjectKey
      const expiresAt = plus(now, SIGNED_URL_TTL_MS)
      const url = await options.signer.signRead(key, expiresAt)
      await options.database.pool.query(
        `insert into moderation_access_audits(
           id, case_id, operator_subject_key, object_key_hash, expires_at, accessed_at
         ) values ($1, $2, $3, $4, $5, $6)`,
        [
          options.uuid.create(),
          caseId,
          operator,
          createHash("sha256").update(rawKey).digest("hex"),
          expiresAt,
          now,
        ],
      )
      return { expiresAt: expiresAt.toISOString(), url }
    },

    resolve: async (
      operatorKey: string | undefined,
      caseId: string,
      input: {
        readonly idempotencyKey: string
        readonly reason: string
        readonly verdict: Verdict
      },
    ) => {
      const operator = await requireRole(operatorKey, "case_reviewer")
      const target = await options.database.pool.query<{
        readonly evidence_id: string | null
        readonly goal_id: string | null
      }>("select evidence_id::text, goal_id::text from moderation_cases where id = $1", [caseId])
      const row = target.rows[0]
      if (row === undefined) throw new ModerationError("CASE_NOT_FOUND", 404)
      if (row.evidence_id !== null) {
        return {
          verdict: await appendVerdict({
            businessKey: `moderation:${caseId}:${input.idempotencyKey}`,
            evidenceId: row.evidence_id,
            operator,
            reason: input.reason,
            requireClaimedCase: true,
            verdict: input.verdict,
          }),
        }
      }
      if (row.goal_id === null) throw new ModerationError("CASE_NOT_FOUND", 404)
      const now = options.clock.now()
      const businessKey = `moderation:${caseId}:${input.idempotencyKey}`
      const result = await options.database.pool.query<{ readonly verdict: Verdict }>(
        `update moderation_cases
         set state = case when $4 = 'accepted' then 'clear' else 'removed' end,
           verdict = $4, resolution_reason = $5, resolution_business_key = $6, resolved_at = $3
         where id = $1 and claimed_by = $2 and claim_expires_at > $3 and resolved_at is null
         returning verdict`,
        [caseId, operator, now, input.verdict, input.reason, businessKey],
      )
      if (result.rows[0] !== undefined) return { verdict: result.rows[0].verdict }
      const replay = await options.database.pool.query<{ readonly verdict: Verdict }>(
        "select verdict from moderation_cases where id = $1 and resolution_business_key = $2",
        [caseId, businessKey],
      )
      if (replay.rows[0] !== undefined) return { verdict: replay.rows[0].verdict }
      const exists = await options.database.pool.query(
        "select resolved_at from moderation_cases where id = $1",
        [caseId],
      )
      if (exists.rowCount !== 1) throw new ModerationError("CASE_NOT_FOUND", 404)
      if (exists.rows[0]?.resolved_at !== null)
        throw new ModerationError("CASE_ALREADY_RESOLVED", 409)
      throw new ModerationError("CASE_ACCESS_DENIED", 403)
    },

    correct: async (
      operatorKey: string | undefined,
      evidenceId: string,
      input: {
        readonly idempotencyKey: string
        readonly reason: string
        readonly verdict: Verdict
      },
    ) => {
      const operator = await requireRole(operatorKey, "case_reviewer")
      return {
        verdict: await appendVerdict({
          businessKey: `evidence:${evidenceId}:correction:${input.idempotencyKey}`,
          evidenceId,
          operator,
          reason: input.reason,
          requireClaimedCase: false,
          verdict: input.verdict,
        }),
      }
    },

    cancelGoal: async (
      operatorKey: string | undefined,
      goalId: string,
      input: { readonly idempotencyKey: string; readonly reason: string },
    ) => {
      const operator = await requireRole(operatorKey, "case_reviewer")
      const now = options.clock.now()
      const client = await options.database.pool.connect()
      await client.query("begin")
      try {
        const replay = await client.query(
          "select 1 from goal_correction_events where business_key = $1",
          [`goal:${goalId}:operator-cancel:${input.idempotencyKey}`],
        )
        if (replay.rowCount === 0) {
          const goal = await client.query(
            "update goals set state = 'cancelled' where id = $1 and state in ('prediction_open', 'evidence_open') returning id",
            [goalId],
          )
          if (goal.rowCount !== 1) throw new ModerationError("GOAL_NOT_FOUND", 404)
          await client.query(
            `insert into goal_correction_events(
               id, goal_id, operator_subject_key, corrected_state, reason, business_key, created_at
             ) values ($1, $2, $3, 'cancelled', $4, $5, $6)`,
            [
              options.uuid.create(),
              goalId,
              operator,
              input.reason,
              `goal:${goalId}:operator-cancel:${input.idempotencyKey}`,
              now,
            ],
          )
        }
        await client.query("commit")
        return { state: "cancelled" as const }
      } catch (error) {
        await client.query("rollback")
        throw error
      } finally {
        client.release()
      }
    },

    runRetention: async (operatorKey: string | undefined) => {
      await requireRole(operatorKey, "retention_operator")
      const now = options.clock.now()
      const database = options.database.pool

      const accountJobs = await database.query<{
        readonly id: string
        readonly goal_ids: string[]
      }>("select id::text, goal_ids from account_deletion_jobs where state = 'queued'")
      for (const accountJob of accountJobs.rows) {
        await database.query(
          `insert into object_deletion_jobs(
             id, evidence_id, source, state, next_attempt_at, created_at
           ) select gen_random_uuid(), e.id, 'account_deletion', 'queued', $2, $2
             from evidences e join evidence_uploads u on u.evidence_id = e.id
             where e.goal_id = any($1::uuid[]) and u.object_key is not null
           on conflict (evidence_id) do update set source = 'account_deletion', state = 'queued', next_attempt_at = $2`,
          [accountJob.goal_ids, now],
        )
      }

      await database.query(
        `insert into object_deletion_jobs(id, evidence_id, source, state, next_attempt_at, created_at)
         select gen_random_uuid(), e.id, 'retention', 'queued', $1, $1
         from evidences e join evidence_uploads u on u.evidence_id = e.id
         left join moderation_cases m on m.evidence_id = e.id
         where u.object_key is not null and (
           (e.resolved_at is not null and coalesce(m.state, 'clear') <> 'reported'
             and $1 >= e.resolved_at + interval '24 hours') or
           ($1 >= e.received_at + interval '7 days') or
           (m.state = 'reported' and $1 >= least(e.received_at + interval '7 days', m.created_at + interval '7 days'))
         ) on conflict (evidence_id) do nothing`,
        [now],
      )

      const due = await database.query<{
        readonly attempt_count: number
        readonly evidence_id: string
        readonly id: string
        readonly object_key: string
        readonly source: string
      }>(
        `with candidates as (
           select id from object_deletion_jobs
           where (
             (state in ('queued', 'retry') and next_attempt_at <= $1) or
             (state = 'running' and locked_at <= $1 - interval '15 minutes')
           )
           order by created_at for update skip locked
         ), claimed as (
           update object_deletion_jobs j set state = 'running', locked_at = $1
           from candidates c where j.id = c.id
           returning j.id, j.evidence_id, j.source, j.attempt_count
         )
         select j.id::text, j.evidence_id::text, j.source, j.attempt_count, u.object_key
         from claimed j join evidence_uploads u on u.evidence_id = j.evidence_id
         where u.object_key is not null`,
        [now],
      )
      let deleted = 0
      let deadLettered = 0
      for (const job of due.rows) {
        const attempt = job.attempt_count + 1
        try {
          await options.objectStore.delete(job.object_key as EvidenceObjectKey)
          const tombstoneExpiresAt = plus(now, TOMBSTONE_TTL_MS)
          await database.query(
            `update evidence_uploads set object_key = null, bytes_deleted_at = $2, tombstone_expires_at = $3
             where evidence_id = $1`,
            [job.evidence_id, now, tombstoneExpiresAt],
          )
          await database.query(
            `update object_deletion_jobs set state = 'completed', attempt_count = $2,
               completed_at = $3, locked_at = null, last_error = null where id = $1`,
            [job.id, attempt, now],
          )
          await database.query(
            `insert into moderation_retention_aggregates(deletion_date, deletion_source, deleted_count)
             values ($1, $2, 1) on conflict (deletion_date, deletion_source)
             do update set deleted_count = moderation_retention_aggregates.deleted_count + 1`,
            [now.toISOString().slice(0, 10), job.source],
          )
          deleted += 1
        } catch (error) {
          const isDeadLetter = attempt >= MAX_DELETE_ATTEMPTS
          await database.query(
            `update object_deletion_jobs set state = $2, attempt_count = $3,
               next_attempt_at = $4, locked_at = null, last_error = $5 where id = $1`,
            [
              job.id,
              isDeadLetter ? "dead_letter" : "retry",
              attempt,
              plus(now, 15 * 60 * 1_000 * 2 ** (attempt - 1)),
              error instanceof Error ? error.message.slice(0, 500) : "object deletion failed",
            ],
          )
          if (isDeadLetter) {
            await database.query(
              `insert into operator_alerts(id, alert_kind, deletion_job_id, created_at)
               values ($1, 'object_delete_dead_letter', $2, $3) on conflict (deletion_job_id) do nothing`,
              [options.uuid.create(), job.id, now],
            )
            deadLettered += 1
          }
        }
      }

      for (const accountJob of accountJobs.rows) {
        const remaining = await database.query(
          `select 1 from evidences e join evidence_uploads u on u.evidence_id = e.id
           where e.goal_id = any($1::uuid[]) and u.object_key is not null limit 1`,
          [accountJob.goal_ids],
        )
        if (remaining.rowCount === 0) {
          await database.query(
            "update account_deletion_jobs set state = 'completed', completed_at = $2 where id = $1",
            [accountJob.id, now],
          )
        }
      }

      const purged = await database.query(
        `update evidence_uploads set sha256 = null, metadata_purged_at = $1
         where tombstone_expires_at <= $1 and metadata_purged_at is null`,
        [now],
      )
      return { deadLettered, deleted, purged: purged.rowCount ?? 0 }
    },
  }
}

export type ModerationService = ReturnType<typeof createModerationService>
