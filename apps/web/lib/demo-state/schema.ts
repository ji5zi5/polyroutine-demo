import { z } from "zod"

const idSchema = z.string().min(1)
const positivePointsSchema = z.number().int().positive()
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const occurredAtSchema = z.iso.datetime()
const choiceSchema = z.union([z.literal("yes"), z.literal("no")])

const profileSchema = z
  .object({
    id: idSchema,
    nickname: z.string().min(1),
    scope: z.literal("device-local"),
  })
  .readonly()

const goalSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1),
    scope: z.literal("device-local"),
  })
  .readonly()

const roundSchema = z
  .object({
    id: idSchema,
    status: z.union([z.literal("open"), z.literal("settled")]),
  })
  .readonly()

const positionSchema = z
  .object({
    choice: choiceSchema,
    goalId: idSchema,
    grossPayout: positivePointsSchema,
    id: idSchema,
    roundId: idSchema,
    stake: positivePointsSchema,
  })
  .readonly()

const ledgerEventSchema = z
  .object({
    amount: positivePointsSchema,
    direction: z.union([z.literal("credit"), z.literal("debit")]),
    id: idSchema,
    occurredAt: occurredAtSchema,
    sourceId: idSchema,
    sourceType: z.union([
      z.literal("attendance"),
      z.literal("coupon_purchase"),
      z.literal("prediction_payout"),
      z.literal("prediction_stake"),
    ]),
  })
  .readonly()

const attendanceSchema = z
  .object({
    eventId: idSchema,
    localDate: localDateSchema,
  })
  .readonly()

const availableCouponSchema = z
  .object({
    catalogId: idSchema,
    cost: positivePointsSchema,
    id: idSchema,
    label: z.string().min(1),
    purchaseEventId: idSchema,
    status: z.literal("available"),
  })
  .readonly()

const usedCouponSchema = z
  .object({
    catalogId: idSchema,
    cost: positivePointsSchema,
    id: idSchema,
    label: z.string().min(1),
    purchaseEventId: idSchema,
    status: z.literal("used"),
    useId: idSchema,
    usedAt: occurredAtSchema,
  })
  .readonly()

export const demoStateSchema = z
  .object({
    attendance: z.array(attendanceSchema).readonly(),
    balance: z.number().int().nonnegative(),
    coupons: z.array(z.union([availableCouponSchema, usedCouponSchema])).readonly(),
    createdAt: occurredAtSchema,
    goals: z.array(goalSchema).min(1).readonly(),
    initialBalance: z.number().int().nonnegative(),
    ledger: z.array(ledgerEventSchema).readonly(),
    positions: z.array(positionSchema).readonly(),
    profile: profileSchema,
    round: roundSchema,
    settledRoundIds: z.array(idSchema).readonly(),
    version: z.literal(1),
  })
  .readonly()

export const demoActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      amount: positivePointsSchema,
      localDate: localDateSchema,
      type: z.literal("claim_attendance"),
    })
    .readonly(),
  z
    .object({
      choice: choiceSchema,
      goalId: idSchema,
      grossPayout: positivePointsSchema,
      roundId: idSchema,
      stake: positivePointsSchema,
      type: z.literal("place_position"),
    })
    .readonly(),
  z
    .object({
      outcomes: z.record(idSchema, choiceSchema),
      roundId: idSchema,
      type: z.literal("settle_round"),
    })
    .readonly(),
  z
    .object({
      catalogId: idSchema,
      cost: positivePointsSchema,
      label: z.string().min(1),
      type: z.literal("purchase_coupon"),
    })
    .readonly(),
  z
    .object({
      couponId: idSchema,
      type: z.literal("use_coupon"),
    })
    .readonly(),
])

export type DemoAction = z.infer<typeof demoActionSchema>
export type DemoState = z.infer<typeof demoStateSchema>
export type AttendanceClaim = DemoState["attendance"][number]
export type CouponInstance = DemoState["coupons"][number]
export type DemoGoal = DemoState["goals"][number]
export type DemoProfile = DemoState["profile"]
export type DemoRound = DemoState["round"]
export type LedgerEvent = DemoState["ledger"][number]
export type PredictionPosition = DemoState["positions"][number]
