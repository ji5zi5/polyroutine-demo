import type { DatabaseHandle } from "@polyroutine/db"
import { GoalServiceError, type GoalView, guidedGoalFieldsSchema } from "./contract.js"

export type DatabaseClient = Pick<DatabaseHandle["pool"], "query">

export type GoalRow = {
  readonly evidence_deadline_at: Date
  readonly goal_copy: string
  readonly id: string
  readonly local_goal_date: string
  readonly owner_subject_key: string
  readonly prediction_cutoff_at: Date
  readonly recipe_id: "study_note_photo_v1"
  readonly recipe_version: 1
  readonly state: GoalView["state"]
}

export function toGoalView(row: GoalRow): GoalView {
  return {
    evidenceDeadlineAt: row.evidence_deadline_at.toISOString(),
    fields: guidedGoalFieldsSchema.parse(JSON.parse(row.goal_copy)),
    id: row.id,
    localGoalDate: row.local_goal_date,
    ownerSubjectKey: row.owner_subject_key,
    predictionCutoffAt: row.prediction_cutoff_at.toISOString(),
    recipeId: row.recipe_id,
    recipeVersion: row.recipe_version,
    state: row.state,
  }
}

export async function findOwnedGoal(
  database: DatabaseHandle,
  subjectKey: string,
  goalId: string,
): Promise<GoalRow> {
  const result = await database.pool.query<GoalRow>(
    `select id::text, owner_subject_key, local_goal_date::text, recipe_id, recipe_version,
       goal_copy, prediction_cutoff_at, evidence_deadline_at, state
     from goals where id = $1 and owner_subject_key = $2`,
    [goalId, subjectKey],
  )
  const row = result.rows[0]
  if (row === undefined) throw new GoalServiceError("GOAL_NOT_FOUND", 404, "goal does not exist")
  return row
}
