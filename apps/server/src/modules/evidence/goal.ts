import { evidenceRecipeV1 } from "@polyroutine/contracts"
import { EvidenceServiceError } from "./errors.js"

export type EvidenceGoalRow = {
  readonly evidence_deadline_at: Date
  readonly id: string
  readonly owner_subject_key: string
  readonly recipe_id: string
  readonly recipe_version: number
  readonly state: string
}

export function assertOwnedOpenGoal(
  goal: EvidenceGoalRow | undefined,
  subjectKey: string,
  now: Date,
): EvidenceGoalRow {
  if (goal === undefined || goal.owner_subject_key !== subjectKey) {
    throw new EvidenceServiceError("GOAL_NOT_FOUND", 404)
  }
  if (
    goal.state !== "evidence_open" ||
    goal.recipe_id !== evidenceRecipeV1.id ||
    goal.recipe_version !== evidenceRecipeV1.version
  ) {
    throw new EvidenceServiceError("EVIDENCE_NOT_OPEN", 409)
  }
  if (now >= goal.evidence_deadline_at) {
    throw new EvidenceServiceError("EVIDENCE_DEADLINE", 409)
  }
  return goal
}
