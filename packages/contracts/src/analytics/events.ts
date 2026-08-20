import { z } from "zod"

const actorSubjectKey = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/)
const machineIdentifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
const timezone = z
  .string()
  .max(64)
  .regex(/^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/)

const cohortFields = {
  actorSubjectKey,
  eventVersion: z.literal(1),
  goalId: z.string().uuid(),
  localCohortDate: z.iso.date(),
  recipeId: z.literal("study_note_photo_v1"),
  recipeVersion: z.literal(1),
  timezone,
} as const

const outcomeFields = {
  ...cohortFields,
  quorumCount: z.number().int().nonnegative(),
} as const

export const analyticsEventNames = [
  "goal_listed",
  "prediction_exposed",
  "prediction_submitted",
  "prediction_shortage_shown",
  "evidence_submitted",
  "verdict_resolved",
  "goal_terminal",
  "reputation_event_appended",
  "next_day_goal_created",
] as const

export const analyticsEventSchema = z.discriminatedUnion("eventName", [
  z.strictObject({
    ...cohortFields,
    eventName: z.literal("goal_listed"),
  }),
  z.strictObject({
    ...cohortFields,
    eventName: z.literal("prediction_exposed"),
  }),
  z.strictObject({
    ...cohortFields,
    choice: z.enum(["yes", "no"]),
    eventName: z.literal("prediction_submitted"),
  }),
  z.strictObject({
    actorSubjectKey,
    eventName: z.literal("prediction_shortage_shown"),
    eventVersion: z.literal(1),
    localCohortDate: z.iso.date(),
    reasonCode: z.literal("eligible_pool_exhausted"),
    requestedCount: z.literal(5),
    returnedCount: z.number().int().min(0).max(4),
    timezone,
  }),
  z.strictObject({
    ...cohortFields,
    attemptNumber: z.number().int().min(1).max(2),
    eventName: z.literal("evidence_submitted"),
  }),
  z.strictObject({
    ...outcomeFields,
    costMicros: z.number().int().nonnegative().optional(),
    eventName: z.literal("verdict_resolved"),
    latencyMilliseconds: z.number().int().nonnegative().optional(),
    providerModel: machineIdentifier.optional(),
    providerVersion: machineIdentifier.optional(),
    reasonCode: z
      .string()
      .regex(/^[a-z0-9_]+$/)
      .max(64),
    verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  }),
  z.strictObject({
    ...outcomeFields,
    eventName: z.literal("goal_terminal"),
    reasonCode: z
      .string()
      .regex(/^[a-z0-9_]+$/)
      .max(64),
    terminalState: z.enum(["completed", "failed", "expired", "cancelled"]),
  }),
  z.strictObject({
    ...outcomeFields,
    eventName: z.literal("reputation_event_appended"),
    eventKind: z.enum(["award", "correction"]),
    points: z.number().int(),
  }),
  z.strictObject({
    ...cohortFields,
    eventName: z.literal("next_day_goal_created"),
  }),
])

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>
export type AnalyticsEventName = (typeof analyticsEventNames)[number]
