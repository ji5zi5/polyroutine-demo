import { z } from "zod"

export const predictionChoiceSchema = z.enum(["yes", "no"])
export type PredictionChoice = z.infer<typeof predictionChoiceSchema>

export const predictionGoalIdSchema = z.string().uuid()
export const predictionSubjectSchema = z.string().trim().min(1).max(128)
export const predictionIdempotencyKeySchema = z.string().trim().min(1).max(128)
export const exposureInputSchema = z.strictObject({ goalId: predictionGoalIdSchema })
export const predictionInputSchema = z.strictObject({ choice: predictionChoiceSchema })

export type FeedCard = {
  readonly anonymousAlias: string
  readonly evidenceDeadlineAt: string
  readonly goalId: string
  readonly predictionCutoffAt: string
  readonly recipe: {
    readonly id: "study_note_photo_v1"
    readonly instructions: string
    readonly version: 1
  }
}

export type PredictionFeed = {
  readonly cards: readonly FeedCard[]
  readonly shortage: {
    readonly nextRefreshAt: string
    readonly reason: "eligible_pool_exhausted"
    readonly requested: 5
    readonly returned: number
  } | null
}

export type PredictionView = {
  readonly choice: PredictionChoice
  readonly goalId: string
  readonly predictionId: string
  readonly submittedAt: string
}

export class PredictionServiceError extends Error {
  override readonly name = "PredictionServiceError"

  constructor(
    readonly code:
      | "EXPOSURE_CONFLICT"
      | "GOAL_NOT_FOUND"
      | "PREDICTION_CLOSED"
      | "PREDICTION_IMMUTABLE"
      | "SELF_PREDICTION",
    readonly statusCode: 404 | 409,
    readonly replacement: boolean,
  ) {
    super(code)
  }
}
