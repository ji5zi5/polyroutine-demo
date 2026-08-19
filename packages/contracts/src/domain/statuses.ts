export const goalStates = [
  "prediction_open",
  "evidence_open",
  "completed",
  "failed",
  "expired",
  "cancelled",
] as const
export type GoalState = (typeof goalStates)[number]

export const evidenceStates = [
  "none",
  "received",
  "pending",
  "accepted",
  "rejected",
  "inconclusive",
] as const
export type EvidenceState = (typeof evidenceStates)[number]

export const moderationStates = ["clear", "quarantined", "reported", "removed"] as const
export type ModerationState = (typeof moderationStates)[number]

export const predictionChoices = ["yes", "no"] as const
export type PredictionChoice = (typeof predictionChoices)[number]

export const terminalGoalStates = ["completed", "failed", "expired", "cancelled"] as const
export type TerminalGoalState = (typeof terminalGoalStates)[number]
