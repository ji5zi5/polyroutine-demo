import type { CouponDebit, CouponInstance } from "./coupon-types"
import {
  couponDebitIdSchema,
  couponDebitSchema,
  couponInstanceIdSchema,
  couponInstanceSchema,
  couponUseIdSchema,
  purchaseCouponInputSchema,
  useCouponInputSchema,
} from "./coupon-types"

type AllocationKind = "coupon" | "debit" | "use"

export type CouponPolicyDependencies = Readonly<{
  nextId: (kind: AllocationKind) => string
  now: () => Date
}>

type PurchaseSuccess = Readonly<{
  balanceAfter: number
  confirmation: string
  coupon: CouponInstance
  debit: CouponDebit
  kind: "purchased"
}>

type PurchaseInsufficient = Readonly<{
  balanceAfter: number
  coupon: null
  debit: null
  heldPoints: number
  kind: "insufficient"
  message: string
  productPrice: number
  shortfall: number
}>

type PurchaseConflict = Readonly<{
  balanceAfter: number
  coupon: null
  debit: null
  id: string
  kind: "conflict"
  reason: "coupon_id_exists" | "debit_id_exists"
}>

export type PurchaseCouponResult = PurchaseSuccess | PurchaseInsufficient | PurchaseConflict

type UseSuccess = Readonly<{
  balanceAfter: number
  balanceBefore: number
  confirmation: string
  coupon: CouponInstance
  kind: "used"
}>

type UseUnchanged = Readonly<{
  balanceAfter: number
  balanceBefore: number
  coupon: CouponInstance
  kind: "already_used"
}>

type UseMissing = Readonly<{
  balanceAfter: number
  balanceBefore: number
  coupon: null
  kind: "not_found"
}>

type UseConflict = Readonly<{
  balanceAfter: number
  balanceBefore: number
  coupon: CouponInstance
  id: string
  kind: "conflict"
  reason: "use_id_exists"
}>

export type UseCouponResult = UseSuccess | UseUnchanged | UseMissing | UseConflict

const points = new Intl.NumberFormat("ko-KR")

function exactShortage(price: number, held: number): string {
  return `가격 ${points.format(price)}P · 보유 ${points.format(held)}P · 부족 ${points.format(price - held)}P`
}

function isoNow(dependencies: CouponPolicyDependencies): string {
  return dependencies.now().toISOString()
}

function allocatedIds(coupons: readonly CouponInstance[], ledgerEventIds: readonly string[]) {
  return new Set<string>([
    ...ledgerEventIds,
    ...coupons.flatMap((coupon) => [
      coupon.id,
      coupon.purchaseEventId,
      ...(coupon.useId === null ? [] : [coupon.useId]),
    ]),
  ])
}

export function purchaseCoupon(
  untrustedInput: unknown,
  dependencies: CouponPolicyDependencies,
): PurchaseCouponResult {
  const input = purchaseCouponInputSchema.parse(untrustedInput)
  if (input.balance < input.product.cost) {
    return {
      balanceAfter: input.balance,
      coupon: null,
      debit: null,
      heldPoints: input.balance,
      kind: "insufficient",
      message: exactShortage(input.product.cost, input.balance),
      productPrice: input.product.cost,
      shortfall: input.product.cost - input.balance,
    }
  }

  const existingIds = allocatedIds(input.coupons, input.ledgerEventIds)
  const couponId = couponInstanceIdSchema.parse(dependencies.nextId("coupon"))
  if (existingIds.has(couponId)) {
    return {
      balanceAfter: input.balance,
      coupon: null,
      debit: null,
      id: couponId,
      kind: "conflict",
      reason: "coupon_id_exists",
    }
  }
  const debitId = couponDebitIdSchema.parse(dependencies.nextId("debit"))
  existingIds.add(couponId)
  if (existingIds.has(debitId)) {
    return {
      balanceAfter: input.balance,
      coupon: null,
      debit: null,
      id: debitId,
      kind: "conflict",
      reason: "debit_id_exists",
    }
  }

  const purchasedAt = isoNow(dependencies)
  const balanceAfter = input.balance - input.product.cost
  const coupon = couponInstanceSchema.parse({
    catalogId: input.product.id,
    cost: input.product.cost,
    id: couponId,
    label: input.product.name,
    purchaseEventId: debitId,
    purchasedAt,
    useId: null,
    usedAt: null,
  })
  const debit = couponDebitSchema.parse({
    amount: input.product.cost,
    id: debitId,
    occurredAt: purchasedAt,
    sourceId: couponId,
  })
  return {
    balanceAfter,
    confirmation: `${input.product.name} 구매가 완료됐어요. ${points.format(input.product.cost)}P를 사용했고 ${points.format(balanceAfter)}P가 남았어요.`,
    coupon,
    debit,
    kind: "purchased",
  }
}

export function useCoupon(
  untrustedInput: unknown,
  dependencies: CouponPolicyDependencies,
): UseCouponResult {
  const input = useCouponInputSchema.parse(untrustedInput)
  const coupon = input.coupons.find((candidate) => candidate.id === input.couponId)
  if (coupon === undefined) {
    return {
      balanceAfter: input.balance,
      balanceBefore: input.balance,
      coupon: null,
      kind: "not_found",
    }
  }
  if (coupon.usedAt !== null) {
    return {
      balanceAfter: input.balance,
      balanceBefore: input.balance,
      coupon,
      kind: "already_used",
    }
  }

  const existingIds = allocatedIds(input.coupons, [])
  const useId = couponUseIdSchema.parse(dependencies.nextId("use"))
  if (existingIds.has(useId)) {
    return {
      balanceAfter: input.balance,
      balanceBefore: input.balance,
      coupon,
      id: useId,
      kind: "conflict",
      reason: "use_id_exists",
    }
  }
  const usedAt = isoNow(dependencies)
  const usedCoupon = couponInstanceSchema.parse({ ...coupon, useId, usedAt })
  return {
    balanceAfter: input.balance,
    balanceBefore: input.balance,
    confirmation: `${coupon.label}을 사용 처리했어요. 포인트는 바뀌지 않았어요.`,
    coupon: usedCoupon,
    kind: "used",
  }
}
