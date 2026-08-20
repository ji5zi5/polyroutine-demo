import type { DatabaseHandle } from "@polyroutine/db"
import { z } from "zod"
import { EvidenceServiceError } from "./errors.js"

const reasonCodeSchema = z
  .enum([
    "challenge_not_visible",
    "image_unreadable",
    "notes_insufficient",
    "recipe_mismatch",
    "review_unavailable",
  ])
  .nullable()

type EvidenceStatusQuery = {
  readonly database: DatabaseHandle
  readonly goalId: string
  readonly now: Date
  readonly subjectKey: string
}

type EvidenceStatusRow = {
  readonly attempt_number: number | null
  readonly evidence_deadline_at: Date
  readonly evidence_id: string | null
  readonly evidence_state: string | null
  readonly goal_state: string
  readonly reason_code: string | null
}

function publicEvidenceState(state: string): "accepted" | "inconclusive" | "pending" | "rejected" {
  switch (state) {
    case "accepted":
      return "accepted"
    case "inconclusive":
      return "inconclusive"
    case "pending":
    case "received":
      return "pending"
    case "rejected":
      return "rejected"
    default:
      throw new TypeError(`unexpected evidence state: ${state}`)
  }
}

export async function getEvidenceStatus(query: EvidenceStatusQuery) {
  const result = await query.database.pool.query<EvidenceStatusRow>(
    `select g.state as goal_state, g.evidence_deadline_at,
       e.id::text as evidence_id, e.attempt_number, e.state as evidence_state,
       (select v.reason_code from evidence_verdict_events v
        where v.evidence_id = e.id
        order by coalesce(v.resolved_at, v.created_at) desc nulls last, v.id desc limit 1
       ) as reason_code
     from goals g
     left join lateral (
       select id, attempt_number, state from evidences
       where goal_id = g.id order by attempt_number desc limit 1
     ) e on true
     where g.id = $1 and g.owner_subject_key = $2`,
    [query.goalId, query.subjectKey],
  )
  const row = result.rows[0]
  if (row === undefined) throw new EvidenceServiceError("GOAL_NOT_FOUND", 404)
  if (row.evidence_id === null || row.attempt_number === null || row.evidence_state === null) {
    return null
  }
  const state = publicEvidenceState(row.evidence_state)
  return {
    attemptNumber: row.attempt_number,
    attemptsRemaining: Math.max(0, 2 - row.attempt_number),
    canResubmit:
      (state === "rejected" || state === "inconclusive") &&
      row.attempt_number < 2 &&
      row.goal_state === "evidence_open" &&
      query.now < row.evidence_deadline_at,
    reasonCode: reasonCodeSchema.parse(row.reason_code),
    receiptId: row.evidence_id,
    state,
  }
}
