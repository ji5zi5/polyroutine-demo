import type { DatabaseHandle } from "@polyroutine/db"
import { type PredictionChoice, PredictionServiceError, type PredictionView } from "./contract.js"

export type PredictionRow = {
  readonly business_key: string
  readonly choice: PredictionChoice
  readonly created_at: Date
  readonly goal_id: string
  readonly id: string
  readonly predictor_subject_key: string
}

export async function findPredictionByBusinessKey(
  client: Pick<DatabaseHandle["pool"], "query">,
  businessKey: string,
): Promise<PredictionRow | undefined> {
  const result = await client.query<PredictionRow>(
    `select id::text, goal_id::text, predictor_subject_key, choice, business_key, created_at
     from predictions where business_key = $1`,
    [businessKey],
  )
  return result.rows[0]
}

export function predictionReplayOrConflict(
  row: PredictionRow,
  subjectKey: string,
  goalId: string,
  choice: PredictionChoice,
): { readonly replayed: true; readonly prediction: PredictionView } {
  if (row.predictor_subject_key === subjectKey && row.goal_id === goalId && row.choice === choice) {
    return { prediction: toPredictionView(row), replayed: true }
  }
  throw new PredictionServiceError("PREDICTION_IMMUTABLE", 409, true)
}

export function predictionServiceError(error: unknown): PredictionServiceError | null {
  if (!(error instanceof Error)) return null
  switch (error.message) {
    case "PR_GOAL_NOT_FOUND":
      return new PredictionServiceError("GOAL_NOT_FOUND", 404, true)
    case "PR_SELF_PREDICTION":
      return new PredictionServiceError("SELF_PREDICTION", 409, true)
    case "PR_PREDICTION_CUTOFF":
      return new PredictionServiceError("PREDICTION_CLOSED", 409, true)
    case "PR_DUPLICATE_PREDICTION":
    case "PR_DUPLICATE_BUSINESS_KEY":
      return new PredictionServiceError("PREDICTION_IMMUTABLE", 409, true)
    default:
      return null
  }
}

export function toPredictionView(row: PredictionRow): PredictionView {
  return {
    choice: row.choice,
    goalId: row.goal_id,
    predictionId: row.id,
    submittedAt: row.created_at.toISOString(),
  }
}
