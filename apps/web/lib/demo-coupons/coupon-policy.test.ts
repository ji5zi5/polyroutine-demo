import { describe, expect, it } from "vitest"
import { couponCatalog, purchaseCoupon } from "./index.js"

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

describe("coupon purchase policy", () => {
  it("creates distinct repeat-purchase instances and exact debits with injected IDs and time", () => {
    // Given: enough points to buy the same catalog product twice
    const product = couponCatalog[0]
    if (product === undefined) throw new TypeError("Expected the fixed coupon catalog")
    const first = purchaseCoupon(
      { balance: 120_000, coupons: [], ledgerEventIds: [], product },
      { nextId: ids("coupon-1", "debit-1"), now: () => fixedNow },
    )
    if (first.kind !== "purchased") throw new TypeError("Expected the first purchase")

    // When: the same product is purchased again with the first result as history
    const second = purchaseCoupon(
      {
        balance: first.balanceAfter,
        coupons: [first.coupon],
        ledgerEventIds: [first.debit.id],
        product,
      },
      { nextId: ids("coupon-2", "debit-2"), now: () => new Date("2026-08-21T01:03:03.000Z") },
    )

    // Then: each purchase is independently addressable and debited once
    expect(second).toMatchObject({
      balanceAfter: 20_000,
      confirmation:
        "GS25 모바일 상품권 1천원권 구매가 완료됐어요. 50,000P를 사용했고 20,000P가 남았어요.",
      coupon: {
        id: "coupon-2",
        purchasedAt: "2026-08-21T01:03:03.000Z",
        usedAt: null,
      },
      debit: { amount: 50_000, id: "debit-2", sourceId: "coupon-2" },
      kind: "purchased",
    })
    expect(first.coupon.id).not.toBe(second.kind === "purchased" ? second.coupon.id : "")
  })

  it("returns exact price held and shortfall without allocating or mutating on insufficient points", () => {
    // Given: a balance one point below the cheapest product and observable dependencies
    const product = couponCatalog[0]
    if (product === undefined) throw new TypeError("Expected the fixed coupon catalog")
    let allocationCount = 0

    // When: purchase eligibility is evaluated
    const result = purchaseCoupon(
      { balance: 49_999, coupons: [], ledgerEventIds: [], product },
      {
        nextId: () => {
          allocationCount += 1
          return "must-not-allocate"
        },
        now: () => fixedNow,
      },
    )

    // Then: the typed shortage is exact and no coupon or debit exists
    expect(result).toEqual({
      balanceAfter: 49_999,
      coupon: null,
      debit: null,
      heldPoints: 49_999,
      kind: "insufficient",
      message: "가격 50,000P · 보유 49,999P · 부족 1P",
      productPrice: 50_000,
      shortfall: 1,
    })
    expect(allocationCount).toBe(0)
  })

  it("rejects stale duplicate IDs without producing a partial coupon or debit", () => {
    // Given: existing identities and an allocator that returns a stale coupon ID
    const product = couponCatalog[0]
    if (product === undefined) throw new TypeError("Expected the fixed coupon catalog")
    const existing = purchaseCoupon(
      { balance: 60_000, coupons: [], ledgerEventIds: [], product },
      { nextId: ids("coupon-stale", "debit-existing"), now: () => fixedNow },
    )
    if (existing.kind !== "purchased") throw new TypeError("Expected the fixture purchase")

    // When: another purchase tries to reuse the stale ID
    const result = purchaseCoupon(
      {
        balance: 60_000,
        coupons: [existing.coupon],
        ledgerEventIds: [existing.debit.id],
        product,
      },
      { nextId: ids("coupon-stale", "debit-new"), now: () => fixedNow },
    )

    // Then: the collision is explicit and carries no mutation payload
    expect(result).toEqual({
      balanceAfter: 60_000,
      coupon: null,
      debit: null,
      id: "coupon-stale",
      kind: "conflict",
      reason: "coupon_id_exists",
    })
  })

  it("rejects malformed inputs and a debit ID that collides with the new coupon ID", () => {
    // Given: malformed external input and a same-value coupon/debit allocator
    const product = couponCatalog[0]
    if (product === undefined) throw new TypeError("Expected the fixed coupon catalog")

    // When: each boundary is evaluated
    const malformed = () =>
      purchaseCoupon(
        { balance: -1, coupons: [], ledgerEventIds: [], product },
        { nextId: ids("unused"), now: () => fixedNow },
      )
    const collision = purchaseCoupon(
      { balance: 60_000, coupons: [], ledgerEventIds: [], product },
      { nextId: ids("same-id", "same-id"), now: () => fixedNow },
    )

    // Then: malformed state never enters the domain and same-value IDs fail atomically
    expect(malformed).toThrow()
    expect(collision).toEqual({
      balanceAfter: 60_000,
      coupon: null,
      debit: null,
      id: "same-id",
      kind: "conflict",
      reason: "debit_id_exists",
    })
  })
})
