import { settleTerminalGoal } from "../../settlement/reputation.js"
import { VerificationServiceError } from "./errors.js"
import {
  type QueueResult,
  type ReviewRow,
  reviewSelection,
  type VerificationDependencies,
} from "./records.js"

const PROCESSING_GRACE_MILLISECONDS = 15 * 60 * 1_000

export async function promoteQueuedJobs(
  dependencies: VerificationDependencies,
): Promise<QueueResult> {
  const client = await dependencies.database.pool.connect()
  await client.query("begin")
  try {
    await client.query("select pg_advisory_xact_lock(hashtext('operator_review_queue_v1'))")
    await client.query(
      `update verification_jobs j set state = 'completed'
       from operator_reviews r
       where j.evidence_id = r.evidence_id and j.state = 'queued'`,
    )
    const depthResult = await client.query<{ readonly depth: string }>(
      "select count(*)::text as depth from operator_reviews where state in ('queued', 'leased')",
    )
    const available = Math.max(
      0,
      dependencies.policy.maxQueueDepth - Number(depthResult.rows[0]?.depth ?? 0),
    )
    const pending = await client.query<{ readonly evidence_id: string; readonly job_id: string }>(
      `select j.id::text as job_id, j.evidence_id::text
       from verification_jobs j
       where j.state = 'queued'
         and not exists (select 1 from operator_reviews r where r.evidence_id = j.evidence_id)
       order by j.created_at, j.id limit $1 for update of j skip locked`,
      [available],
    )
    for (const job of pending.rows) {
      await client.query(
        `insert into operator_reviews(id, evidence_id, state, created_at)
         values ($1, $2, 'queued', $3)`,
        [dependencies.uuid.create(), job.evidence_id, dependencies.clock.now()],
      )
      await client.query("update verification_jobs set state = 'completed' where id = $1", [
        job.job_id,
      ])
    }
    const remaining = await client.query<{ readonly pending: boolean }>(
      "select exists(select 1 from verification_jobs where state = 'queued') as pending",
    )
    await client.query("commit")
    return { promoted: pending.rows.length, saturated: remaining.rows[0]?.pending ?? false }
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export async function promoteVerificationJob(
  dependencies: VerificationDependencies,
  verificationJobId: string,
): Promise<boolean> {
  const client = await dependencies.database.pool.connect()
  await client.query("begin")
  try {
    await client.query("select pg_advisory_xact_lock(hashtext('operator_review_queue_v1'))")
    const jobResult = await client.query<{
      readonly evidence_id: string
      readonly state: "queued" | "running" | "completed" | "failed"
    }>("select evidence_id::text, state from verification_jobs where id = $1 for update", [
      verificationJobId,
    ])
    const job = jobResult.rows[0]
    if (job === undefined) {
      throw new VerificationServiceError("VERIFICATION_JOB_NOT_FOUND", 404)
    }
    if (job.state !== "queued") {
      await client.query("commit")
      return false
    }
    const existing = await client.query("select 1 from operator_reviews where evidence_id = $1", [
      job.evidence_id,
    ])
    if (existing.rowCount === 0) {
      const depth = await client.query<{ readonly count: string }>(
        `select count(*)::text as count from operator_reviews
         where state in ('queued', 'leased')`,
      )
      if (Number(depth.rows[0]?.count ?? 0) >= dependencies.policy.maxQueueDepth) {
        throw new VerificationServiceError("OPERATOR_QUEUE_SATURATED", 503)
      }
      await client.query(
        `insert into operator_reviews(id, evidence_id, state, created_at)
         values ($1, $2, 'queued', $3)`,
        [dependencies.uuid.create(), job.evidence_id, dependencies.clock.now()],
      )
    }
    await client.query("update verification_jobs set state = 'completed' where id = $1", [
      verificationJobId,
    ])
    await client.query("commit")
    return true
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export async function claimReview(
  dependencies: VerificationDependencies,
  operatorSubjectKey: string,
) {
  const promotion = await promoteQueuedJobs(dependencies)
  const now = dependencies.clock.now()
  const client = await dependencies.database.pool.connect()
  await client.query("begin")
  try {
    const expired = await client.query<ReviewRow>(
      `${reviewSelection}
       where r.state = 'leased' and r.lease_expires_at <= $1
       order by r.lease_expires_at, r.id for update of r, g`,
      [now],
    )
    for (const review of expired.rows) {
      const exhausted = review.lease_attempts >= dependencies.policy.maxLeaseAttempts
      await client.query(
        `update operator_reviews set state = $1, leased_by = null, lease_token = null,
           lease_expires_at = null where id = $2`,
        [exhausted ? "exhausted" : "queued", review.review_id],
      )
      if (
        exhausted &&
        review.goal_state === "evidence_open" &&
        now.getTime() >= review.evidence_deadline_at.getTime() + PROCESSING_GRACE_MILLISECONDS
      ) {
        await settleTerminalGoal({
          actor: "operator",
          client,
          goalId: review.goal_id,
          now,
          state: "expired",
        })
      }
    }

    const claimed = await client.query<ReviewRow>(
      `${reviewSelection}
       where r.state = 'queued' and r.lease_attempts < $1
       order by r.created_at, r.id limit 1 for update of r skip locked`,
      [dependencies.policy.maxLeaseAttempts],
    )
    const review = claimed.rows[0]
    if (review === undefined) {
      if (promotion.saturated) {
        throw new VerificationServiceError("OPERATOR_QUEUE_SATURATED", 503)
      }
      await client.query("commit")
      return null
    }
    const leaseToken = dependencies.uuid.create()
    const leaseExpiresAt = new Date(now.getTime() + dependencies.policy.leaseMilliseconds)
    await client.query(
      `update operator_reviews set state = 'leased', lease_attempts = lease_attempts + 1,
         leased_by = $1, lease_token = $2, lease_expires_at = $3 where id = $4`,
      [operatorSubjectKey, leaseToken, leaseExpiresAt, review.review_id],
    )
    await client.query("commit")
    return {
      evidenceId: review.evidence_id,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      leaseToken,
      reviewId: review.review_id,
    }
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}
