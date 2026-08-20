import { z } from "zod"

export const guidedGoalFieldsSchema = z.strictObject({
  noteLineTarget: z.number().int().min(3).max(20),
  studyMinutes: z.literal(25),
})
export type GuidedGoalFields = Readonly<z.infer<typeof guidedGoalFieldsSchema>>

export const cancelGoalSchema = z.discriminatedUnion("actor", [
  z.strictObject({ actor: z.literal("owner") }),
  z.strictObject({ actor: z.literal("operator"), reason: z.string().trim().min(1).max(500) }),
])
export type CancelGoalInput = Readonly<z.infer<typeof cancelGoalSchema>>

export const goalIdSchema = z.string().uuid()
export const idempotencyKeySchema = z.string().trim().min(1).max(128)
export const subjectKeySchema = z.string().trim().min(1).max(128)

export const goalErrorCodes = [
  "DAILY_GOAL_EXISTS",
  "GOAL_IMMUTABLE",
  "GOAL_NOT_FOUND",
  "SUBJECT_NOT_FOUND",
] as const
export type GoalErrorCode = (typeof goalErrorCodes)[number]

export class GoalServiceError extends Error {
  override readonly name = "GoalServiceError"

  constructor(
    readonly code: GoalErrorCode,
    readonly statusCode: 404 | 409,
    message: string,
  ) {
    super(message)
  }
}

export type GoalView = {
  readonly evidenceDeadlineAt: string
  readonly fields: GuidedGoalFields
  readonly id: string
  readonly localGoalDate: string
  readonly ownerSubjectKey: string
  readonly predictionCutoffAt: string
  readonly recipeId: "study_note_photo_v1"
  readonly recipeVersion: 1
  readonly state:
    | "prediction_open"
    | "evidence_open"
    | "completed"
    | "failed"
    | "expired"
    | "cancelled"
}

export type ReputationEventView =
  | { readonly eventKey: string; readonly kind: "completion"; readonly points: number }
  | { readonly eventKey: string; readonly kind: "crowd"; readonly points: number }
  | {
      readonly correctedState: "cancelled" | "completed" | "expired" | "failed"
      readonly eventKey: string
      readonly kind: "correction"
      readonly points: number
      readonly reason: string
    }

export type DailyResultView = {
  readonly crowd: { readonly no: number; readonly yes: number }
  readonly effectiveState: "cancelled" | "completed" | "expired" | "failed"
  readonly goal: GoalView
  readonly reputationEvents: readonly ReputationEventView[]
  readonly reputationTotal: number
}

export type TodayView = {
  readonly goal: GoalView | null
  readonly result: DailyResultView | null
}
