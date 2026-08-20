import { z } from "zod"

export const sessionSchema = z.object({
  csrfToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
  token: z.string().min(1),
})

export const accountSchema = z.object({
  session: sessionSchema,
  subjectKey: z.string().min(1),
})
export type Account = Readonly<z.infer<typeof accountSchema>>

export const goalSchema = z.object({
  evidenceDeadlineAt: z.iso.datetime(),
  fields: z.object({
    noteLineTarget: z.number().int().min(3).max(20),
    studyMinutes: z.literal(25),
  }),
  id: z.uuid(),
  localGoalDate: z.string(),
  ownerSubjectKey: z.string(),
  predictionCutoffAt: z.iso.datetime(),
  recipeId: z.literal("study_note_photo_v1"),
  recipeVersion: z.literal(1),
  state: z.enum([
    "prediction_open",
    "evidence_open",
    "completed",
    "failed",
    "expired",
    "cancelled",
  ]),
})
export type Goal = Readonly<z.infer<typeof goalSchema>>

export const todayResponseSchema = z.object({ goal: goalSchema.nullable() })

export const feedCardSchema = z.object({
  anonymousAlias: z.string(),
  evidenceDeadlineAt: z.iso.datetime(),
  goalId: z.uuid(),
  predictionCutoffAt: z.iso.datetime(),
  recipe: z.object({
    id: z.literal("study_note_photo_v1"),
    instructions: z.string(),
    version: z.literal(1),
  }),
})

export const shortageSchema = z.object({
  nextRefreshAt: z.iso.datetime(),
  reason: z.literal("eligible_pool_exhausted"),
  requested: z.literal(5),
  returned: z.number().int().min(0).max(4),
})

export const predictionFeedSchema = z.object({
  cards: z.array(feedCardSchema).max(5),
  shortage: shortageSchema.nullable(),
})
export type PredictionFeed = Readonly<z.infer<typeof predictionFeedSchema>>

export const predictionSchema = z.object({
  choice: z.enum(["yes", "no"]),
  goalId: z.uuid(),
  predictionId: z.uuid(),
  submittedAt: z.iso.datetime(),
})

export const evidenceChallengeSchema = z.object({
  challengeId: z.uuid(),
  claim: z.literal("replay_reduction_only"),
  code: z.string().regex(/^PR-[A-F0-9]{8}$/),
  expiresAt: z.iso.datetime(),
  instructions: z.string().min(1),
  issuedAt: z.iso.datetime(),
})
export type EvidenceChallenge = Readonly<z.infer<typeof evidenceChallengeSchema>>

export const evidenceReceiptSchema = z.object({
  receipt_id: z.uuid(),
  state: z.literal("pending"),
})
export type EvidenceReceipt = Readonly<z.infer<typeof evidenceReceiptSchema>>

export const evidenceReasonCodeSchema = z
  .enum([
    "challenge_not_visible",
    "image_unreadable",
    "notes_insufficient",
    "recipe_mismatch",
    "review_unavailable",
  ])
  .nullable()

export const evidenceStatusSchema = z.object({
  attemptNumber: z.number().int().min(1).max(2),
  attemptsRemaining: z.number().int().min(0).max(1),
  canResubmit: z.boolean(),
  reasonCode: evidenceReasonCodeSchema,
  receiptId: z.uuid(),
  state: z.enum(["pending", "accepted", "rejected", "inconclusive"]),
})
export type EvidenceStatus = Readonly<z.infer<typeof evidenceStatusSchema>>
export const evidenceStatusResponseSchema = z.object({ evidence: evidenceStatusSchema.nullable() })

export const apiErrorSchema = z.object({
  code: z.string().optional(),
  error: z.string().optional(),
  replacement: z.boolean().optional(),
})
