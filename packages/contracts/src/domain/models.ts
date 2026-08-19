import type {
  EvidenceState,
  GoalState,
  ModerationState,
  PredictionChoice,
  TerminalGoalState,
} from "./statuses.js"

declare const brand: unique symbol
export type Brand<T, Name extends string> = T & { readonly [brand]: Name }
export type SubjectKey = Brand<string, "SubjectKey">
export type GoalId = Brand<string, "GoalId">
export type PredictionId = Brand<string, "PredictionId">
export type EvidenceId = Brand<string, "EvidenceId">
export type BusinessKey = Brand<string, "BusinessKey">
export type IanaTimezone = Brand<string, "IanaTimezone">
export type UtcInstant = Brand<Date, "UtcInstant">
export type LocalGoalDate = Brand<string, "LocalGoalDate">

export type Goal = {
  readonly id: GoalId
  readonly ownerSubjectKey: SubjectKey
  readonly localGoalDate: LocalGoalDate
  readonly recipeId: "study_note_photo_v1"
  readonly recipeVersion: 1
  readonly goalCopy: string
  readonly predictionCutoffAt: UtcInstant
  readonly evidenceDeadlineAt: UtcInstant
  readonly state: GoalState
}

export type Prediction = {
  readonly id: PredictionId
  readonly goalId: GoalId
  readonly predictorSubjectKey: SubjectKey
  readonly choice: PredictionChoice
  readonly businessKey: BusinessKey
}

export type EvidenceAuthority = {
  readonly evidenceId: EvidenceId | null
  readonly goalId: GoalId
  readonly state: EvidenceState
  readonly attemptNumber: 0 | 1 | 2
}

export type ModerationAuthority = {
  readonly goalId: GoalId
  readonly state: ModerationState
}

export type ReputationEvent = {
  readonly businessKey: BusinessKey
  readonly points: number
  readonly reason: string | null
  readonly referenceBusinessKey: BusinessKey | null
  readonly subjectKey: SubjectKey
  readonly kind: "award" | "correction"
}

export type GoalCorrectionEvent = {
  readonly businessKey: BusinessKey
  readonly correctedState: TerminalGoalState
  readonly goalId: GoalId
  readonly operatorSubjectKey: SubjectKey
  readonly reason: string
}
