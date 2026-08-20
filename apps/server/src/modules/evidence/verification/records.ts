import type { Clock, TerminalGoalState, UuidFactory } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import type { OperatorDecision, ReviewPolicy } from "./contract.js"

export type VerificationDependencies = {
  readonly clock: Clock
  readonly database: DatabaseHandle
  readonly policy: ReviewPolicy
  readonly uuid: UuidFactory
}

export type QueueResult = {
  readonly promoted: number
  readonly saturated: boolean
}

export type ReviewRow = {
  readonly evidence_deadline_at: Date
  readonly evidence_id: string
  readonly evidence_state: string
  readonly goal_id: string
  readonly goal_state: string
  readonly lease_attempts: number
  readonly lease_expires_at: Date | null
  readonly lease_token: string | null
  readonly leased_by: string | null
  readonly owner_subject_key: string
  readonly review_id: string
  readonly review_state: string
  readonly user_attempt_number: number
}

export type VerdictRow = {
  readonly operator_subject_key: string
  readonly reason_code: string | null
  readonly terminal_state: TerminalGoalState | null
  readonly verdict: OperatorDecision["verdict"]
}

export const reviewSelection = `select r.id::text as review_id, r.evidence_id::text,
  r.state as review_state, r.lease_attempts, r.leased_by, r.lease_token::text,
  r.lease_expires_at, e.state as evidence_state, e.attempt_number as user_attempt_number,
  g.id::text as goal_id, g.state as goal_state, g.owner_subject_key, g.evidence_deadline_at
from operator_reviews r join evidences e on e.id = r.evidence_id
join goals g on g.id = e.goal_id` as const
