import type { TerminalGoalState } from "@polyroutine/contracts"
import { SettlementConflictError, settleTerminalGoal } from "../../settlement/reputation.js"
import type { OperatorDecision } from "./contract.js"
import { VerificationServiceError } from "./errors.js"
import {
  type ReviewRow,
  reviewSelection,
  type VerdictRow,
  type VerificationDependencies,
} from "./records.js"

const PROCESSING_GRACE_MILLISECONDS = 15 * 60 * 1_000

export type VerdictCommand = {
  readonly decision: OperatorDecision
  readonly idempotencyKey: string
  readonly leaseToken: string
  readonly operatorSubjectKey: string
  readonly reviewId: string
}

function assertNever(value: never): never {
  throw new TypeError(`unexpected operator decision: ${String(value)}`)
}

function decisionReason(decision: OperatorDecision): string | null {
  switch (decision.verdict) {
    case "accepted":
      return null
    case "rejected":
    case "inconclusive":
      return decision.reasonCode
    default:
      return assertNever(decision)
  }
}

function terminalFor(
  decision: OperatorDecision,
  review: ReviewRow,
  now: Date,
): TerminalGoalState | null {
  switch (decision.verdict) {
    case "accepted":
      return "completed"
    case "rejected":
      return review.user_attempt_number >= 2 || now >= review.evidence_deadline_at ? "failed" : null
    case "inconclusive":
      return now.getTime() >= review.evidence_deadline_at.getTime() + PROCESSING_GRACE_MILLISECONDS
        ? "expired"
        : null
    default:
      return assertNever(decision)
  }
}

function matchesVerdict(
  prior: VerdictRow,
  operatorSubjectKey: string,
  decision: OperatorDecision,
): boolean {
  return (
    prior.operator_subject_key === operatorSubjectKey &&
    prior.verdict === decision.verdict &&
    prior.reason_code === decisionReason(decision)
  )
}

export async function decideReview(
  dependencies: VerificationDependencies,
  command: VerdictCommand,
) {
  const now = dependencies.clock.now()
  const client = await dependencies.database.pool.connect()
  await client.query("begin")
  try {
    const reviewResult = await client.query<ReviewRow>(
      `${reviewSelection} where r.id = $1 for update of r, e, g`,
      [command.reviewId],
    )
    const review = reviewResult.rows[0]
    if (review === undefined) throw new VerificationServiceError("REVIEW_NOT_FOUND", 404)
    const businessKey = `evidence:${review.evidence_id}:verdict:${command.idempotencyKey}`
    const replay = await client.query<VerdictRow>(
      `select operator_subject_key, verdict, reason_code, terminal_state
       from evidence_verdict_events where business_key = $1`,
      [businessKey],
    )
    const prior = replay.rows[0]
    if (prior !== undefined) {
      if (!matchesVerdict(prior, command.operatorSubjectKey, command.decision)) {
        throw new VerificationServiceError("VERDICT_CONFLICT", 409)
      }
      await client.query("commit")
      return {
        goalState: prior.terminal_state ?? review.goal_state,
        replayed: true as const,
        verdict: prior.verdict,
      }
    }
    if (
      review.review_state !== "leased" ||
      review.leased_by !== command.operatorSubjectKey ||
      review.lease_token !== command.leaseToken ||
      review.lease_expires_at === null ||
      now >= review.lease_expires_at
    ) {
      throw new VerificationServiceError("REVIEW_LEASE_STALE", 409)
    }
    if (review.goal_state !== "evidence_open") {
      throw new VerificationServiceError("GOAL_ALREADY_TERMINAL", 409)
    }
    const terminalState = terminalFor(command.decision, review, now)
    await client.query("update evidences set state = $1 where id = $2", [
      command.decision.verdict,
      review.evidence_id,
    ])
    if (terminalState !== null) {
      try {
        await settleTerminalGoal({
          actor: "operator",
          client,
          goalId: review.goal_id,
          now,
          state: terminalState,
        })
      } catch (error) {
        if (error instanceof SettlementConflictError) {
          throw new VerificationServiceError("GOAL_ALREADY_TERMINAL", 409)
        }
        throw error
      }
    }
    await client.query(
      `insert into evidence_verdict_events(
         evidence_id, review_id, operator_subject_key, verdict, reason_code,
         terminal_state, business_key, resolved_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        review.evidence_id,
        review.review_id,
        command.operatorSubjectKey,
        command.decision.verdict,
        decisionReason(command.decision),
        terminalState,
        businessKey,
        now,
      ],
    )
    await client.query(
      `insert into analytics_events(event_name, business_key, payload, occurred_at)
       values ('verdict_resolved', $1, $2::jsonb, $3)`,
      [
        `evidence:${review.evidence_id}:verdict:v1`,
        JSON.stringify({
          evidenceId: review.evidence_id,
          goalId: review.goal_id,
          terminalState,
          verdict: command.decision.verdict,
        }),
        now,
      ],
    )
    await client.query(
      `update operator_reviews set state = 'decided', leased_by = null, lease_token = null,
         lease_expires_at = null, decided_at = $1 where id = $2`,
      [now, review.review_id],
    )
    await client.query("commit")
    return {
      goalState: terminalState ?? review.goal_state,
      replayed: false as const,
      verdict: command.decision.verdict,
    }
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}
