import { describe, expect, it } from "vitest"
import {
  couponCatalog,
  purchaseCoupon,
  selectAvailableCoupons,
  selectCouponOwnership,
  selectUsedCoupons,
  useCoupon,
} from "./index.js"

const fixedNow = new Date("2026-08-21T01:02:03.000Z")

function ids(...values: readonly string[]) {
  let index = 0
  return () => {
    const value = values[index]
    index += 1
    if (value === undefined) throw new TypeError("No deterministic coupon ID remains")
    return value
  }
}

describe("coupon use policy and selectors", () => {
  it("requires a confirmation result, keeps points unchanged, and is idempotent", () => {
    // Given: one available coupon instance
    const product = couponCatalog[0]
    if (product === undefined) throw new TypeError("Expected the fixed coupon catalog")
    const purchase = purchaseCoupon(
      { balance: 60_000, coupons: [], ledgerEventIds: [], product },
      { nextId: ids("coupon-use", "debit-use"), now: () => fixedNow },
    )
    if (purchase.kind !== "purchased") throw new TypeError("Expected the fixture purchase")

    // When: use is confirmed, then replayed against the used result
    const used = useCoupon(
      { balance: purchase.balanceAfter, couponId: purchase.coupon.id, coupons: [purchase.coupon] },
      { nextId: ids("use-1"), now: () => new Date("2026-08-21T02:00:00.000Z") },
    )
    if (used.kind !== "used") throw new TypeError("Expected coupon use")
    const replayed = useCoupon(
      { balance: used.balanceAfter, couponId: used.coupon.id, coupons: [used.coupon] },
      { nextId: () => "must-not-allocate", now: () => fixedNow },
    )

    // Then: confirmation changes only coupon use metadata and replay is a no-op
    expect(used).toMatchObject({
      balanceAfter: 10_000,
      balanceBefore: 10_000,
      coupon: { useId: "use-1", usedAt: "2026-08-21T02:00:00.000Z" },
      kind: "used",
    })
    expect(replayed).toEqual({
      balanceAfter: 10_000,
      balanceBefore: 10_000,
      coupon: used.coupon,
      kind: "already_used",
    })
  })

  it("groups available used and per-product ownership without dropping history", () => {
    // Given: two repeat purchases with only one used
    const product = couponCatalog[0]
    if (product === undefined) throw new TypeError("Expected the fixed coupon catalog")
    const first = purchaseCoupon(
      { balance: 120_000, coupons: [], ledgerEventIds: [], product },
      { nextId: ids("coupon-a", "debit-a"), now: () => fixedNow },
    )
    if (first.kind !== "purchased") throw new TypeError("Expected the first fixture purchase")
    const second = purchaseCoupon(
      {
        balance: first.balanceAfter,
        coupons: [first.coupon],
        ledgerEventIds: [first.debit.id],
        product,
      },
      { nextId: ids("coupon-b", "debit-b"), now: () => fixedNow },
    )
    if (second.kind !== "purchased") throw new TypeError("Expected the second fixture purchase")
    const used = useCoupon(
      {
        balance: second.balanceAfter,
        couponId: first.coupon.id,
        coupons: [first.coupon, second.coupon],
      },
      { nextId: ids("use-a"), now: () => fixedNow },
    )
    if (used.kind !== "used") throw new TypeError("Expected the fixture use")
    const coupons = [used.coupon, second.coupon]

    // When: wallet selectors derive the histories and catalog ownership
    const ownership = selectCouponOwnership(couponCatalog, coupons)

    // Then: available and used remain individually visible with exact quantity context
    expect(selectAvailableCoupons(coupons).map((coupon) => coupon.id)).toEqual(["coupon-b"])
    expect(selectUsedCoupons(coupons).map((coupon) => coupon.id)).toEqual(["coupon-a"])
    expect(ownership[0]).toMatchObject({ available: 1, owned: 2, used: 1 })
  })

  it("returns a neutral missing result and rejects a stale use ID without changing points", () => {
    // Given: one available coupon and no matching coupon for a separate request
    const product = couponCatalog[0]
    if (product === undefined) throw new TypeError("Expected the fixed coupon catalog")
    const purchase = purchaseCoupon(
      { balance: 60_000, coupons: [], ledgerEventIds: [], product },
      { nextId: ids("coupon-existing", "debit-existing"), now: () => fixedNow },
    )
    if (purchase.kind !== "purchased") throw new TypeError("Expected the fixture purchase")

    // When: a missing coupon and a stale use identity are submitted
    const missing = useCoupon(
      { balance: purchase.balanceAfter, couponId: "missing", coupons: [purchase.coupon] },
      { nextId: ids("unused"), now: () => fixedNow },
    )
    const conflict = useCoupon(
      {
        balance: purchase.balanceAfter,
        couponId: purchase.coupon.id,
        coupons: [purchase.coupon],
      },
      { nextId: ids("coupon-existing"), now: () => fixedNow },
    )

    // Then: neither path spends points or manufactures use metadata
    expect(missing).toEqual({
      balanceAfter: 10_000,
      balanceBefore: 10_000,
      coupon: null,
      kind: "not_found",
    })
    expect(conflict).toEqual({
      balanceAfter: 10_000,
      balanceBefore: 10_000,
      coupon: purchase.coupon,
      id: "coupon-existing",
      kind: "conflict",
      reason: "use_id_exists",
    })
  })
})
