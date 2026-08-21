import { z } from "zod"

export const couponCatalogIdSchema = z.string().trim().min(1).brand<"CouponCatalogId">()
export const couponInstanceIdSchema = z.string().trim().min(1).brand<"CouponInstanceId">()
export const couponDebitIdSchema = z.string().trim().min(1).brand<"CouponDebitId">()
export const couponUseIdSchema = z.string().trim().min(1).brand<"CouponUseId">()

const pointsSchema = z.number().int().nonnegative()
const positivePointsSchema = z.number().int().positive()

export const rewardProductSchema = z
  .object({
    cost: positivePointsSchema,
    id: couponCatalogIdSchema,
    imageSrc: z.string().regex(/^\/rewards\/[a-z0-9-]+\.(?:jpe?g|png)$/),
    name: z.string().trim().min(1),
  })
  .readonly()

export const couponInstanceSchema = z
  .object({
    catalogId: couponCatalogIdSchema,
    cost: positivePointsSchema,
    id: couponInstanceIdSchema,
    label: z.string().trim().min(1),
    purchaseEventId: couponDebitIdSchema,
    purchasedAt: z.iso.datetime(),
    useId: couponUseIdSchema.nullable(),
    usedAt: z.iso.datetime().nullable(),
  })
  .superRefine((coupon, context) => {
    if ((coupon.useId === null) !== (coupon.usedAt === null)) {
      context.addIssue({
        code: "custom",
        message: "useId and usedAt must change together",
        path: ["usedAt"],
      })
    }
  })
  .readonly()

export const couponDebitSchema = z
  .object({
    amount: positivePointsSchema,
    id: couponDebitIdSchema,
    occurredAt: z.iso.datetime(),
    sourceId: couponInstanceIdSchema,
  })
  .readonly()

export const purchaseCouponInputSchema = z
  .object({
    balance: pointsSchema,
    coupons: z.array(couponInstanceSchema).readonly(),
    ledgerEventIds: z.array(couponDebitIdSchema).readonly(),
    product: rewardProductSchema,
  })
  .readonly()

export const useCouponInputSchema = z
  .object({
    balance: pointsSchema,
    couponId: couponInstanceIdSchema,
    coupons: z.array(couponInstanceSchema).readonly(),
  })
  .readonly()

export type CouponCatalogId = z.infer<typeof couponCatalogIdSchema>
export type CouponDebit = z.infer<typeof couponDebitSchema>
export type CouponInstance = z.infer<typeof couponInstanceSchema>
export type CouponInstanceId = z.infer<typeof couponInstanceIdSchema>
export type RewardProduct = z.infer<typeof rewardProductSchema>
