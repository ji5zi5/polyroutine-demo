import { z } from "zod"
import { couponInstanceSchema } from "../demo-coupons/coupon-types"

const idSchema = z.string().min(1)
const positivePointsSchema = z.number().int().positive()
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const localDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

function isValidLocalDateTime(value: string): boolean {
  if (!localDateTimePattern.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const hour = Number(value.slice(11, 13))
  const minute = Number(value.slice(14, 16))
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth =
    month === 2
      ? leapYear
        ? 29
        : 28
      : month === 4 || month === 6 || month === 9 || month === 11
        ? 30
        : 31
  return day >= 1 && day <= daysInMonth
}

const localDateTimeSchema = z
  .string()
  .regex(localDateTimePattern)
  .refine(isValidLocalDateTime, "invalid datetime-local value")
const occurredAtSchema = z.iso.datetime()
const choiceSchema = z.union([z.literal("yes"), z.literal("no")])
const goalTitleSchema = z.string().trim().min(1).max(120)

export const ATTENDANCE_CREDIT_POINTS = 200 as const

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

const listedGoalSchema = z
  .object({
    deadline: localDateTimeSchema,
    id: idSchema,
    probability: z.number().int().min(0).max(100),
    titles: z.array(goalTitleSchema).min(1).max(5).readonly(),
  })
  .superRefine((listing, context) => {
    if (new Set(listing.titles).size !== listing.titles.length) {
      context.addIssue({ code: "custom", message: "goal titles must be unique", path: ["titles"] })
    }
  })
  .readonly()

const roundSchema = z
  .object({
    id: idSchema,
    openedAt: occurredAtSchema.optional(),
    status: z.union([z.literal("open"), z.literal("settled")]),
  })
  .readonly()

const legacyPositionSchema = z
  .object({
    choice: choiceSchema,
    goalId: idSchema,
    grossPayout: positivePointsSchema,
    id: idSchema,
    roundId: idSchema,
    stake: positivePointsSchema,
  })
  .readonly()

const marketPositionObjectSchema = z.object({
  cardId: idSchema,
  cardLabel: z.string().min(1),
  choice: choiceSchema,
  crowdPercentage: z.number().int().min(1).max(99),
  fixtureOutcome: choiceSchema,
  grossPayout: positivePointsSchema,
  id: idSchema,
  kind: z.literal("market"),
  placedAt: occurredAtSchema,
  roundId: idSchema,
  stake: z.literal(100),
})

const marketPositionSchema = marketPositionObjectSchema.readonly()

const archivedMarketPositionSchema = marketPositionObjectSchema
  .omit({ kind: true })
  .extend({
    actualOutcome: choiceSchema,
    payout: z.number().int().nonnegative(),
    result: z.union([z.literal("won"), z.literal("lost")]),
    settledAt: occurredAtSchema,
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
      z.literal("goal_completion"),
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

export const demoStateSchema = z
  .object({
    attendance: z.array(attendanceSchema).readonly(),
    balance: z.number().int().nonnegative(),
    coupons: z.array(couponInstanceSchema).readonly(),
    createdAt: occurredAtSchema,
    goals: z.array(goalSchema).max(5).readonly(),
    initialBalance: z.number().int().nonnegative(),
    ledger: z.array(ledgerEventSchema).readonly(),
    listedGoals: z.array(listedGoalSchema).max(50).readonly().default([]),
    marketHistory: z.array(archivedMarketPositionSchema).readonly().default([]),
    positions: z.array(z.union([legacyPositionSchema, marketPositionSchema])).readonly(),
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
      goalId: idSchema,
      type: z.literal("credit_goal_completion"),
    })
    .readonly(),
  z
    .object({
      amount: z.literal(ATTENDANCE_CREDIT_POINTS),
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
      cardId: idSchema,
      cardLabel: z.string().min(1),
      choice: choiceSchema,
      crowdPercentage: z.number().int().min(1).max(99),
      fixtureOutcome: choiceSchema,
      roundId: idSchema,
      stake: z.literal(100),
      type: z.literal("place_market_position"),
    })
    .readonly(),
  z
    .object({
      cardId: idSchema,
      type: z.literal("skip_market_card"),
    })
    .readonly(),
  z
    .object({
      roundId: idSchema,
      type: z.literal("settle_market_round"),
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
      deadline: localDateTimeSchema,
      probability: z.number().int().min(0).max(100),
      titles: z.array(goalTitleSchema).min(1).max(5).readonly(),
      type: z.literal("list_goals"),
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
  z
    .object({
      titles: z.array(goalTitleSchema).max(5).readonly(),
      type: z.literal("replace_goals"),
    })
    .readonly(),
  z
    .object({
      deadline: localDateTimeSchema,
      listingId: idSchema,
      type: z.literal("update_listed_goal_deadline"),
    })
    .readonly(),
  z
    .object({
      nickname: z.string().trim().min(1).max(16),
      type: z.literal("update_profile"),
    })
    .readonly(),
])

export type DemoAction = z.infer<typeof demoActionSchema>
export type DemoState = z.infer<typeof demoStateSchema>
export type AttendanceClaim = DemoState["attendance"][number]
export type CouponInstance = DemoState["coupons"][number]
export type DemoGoal = DemoState["goals"][number]
export type ListedGoal = DemoState["listedGoals"][number]
export type DemoProfile = DemoState["profile"]
export type DemoRound = DemoState["round"]
export type LedgerEvent = DemoState["ledger"][number]
export type PredictionPosition = DemoState["positions"][number]
export type MarketPosition = Extract<PredictionPosition, { readonly kind: "market" }>
export type ArchivedMarketPosition = DemoState["marketHistory"][number]
