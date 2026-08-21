import { describe, expect, it } from "vitest"
import { createInitialDemoState, reduceDemoState } from "../demo-state"
import { selectMySummary } from "./my-view-model"

function dependencies() {
  let index = 0
  return {
    createId: () => {
      index += 1
      return `my-test-${index}`
    },
    now: () => new Date(`2026-08-21T09:00:${String(index).padStart(2, "0")}.000Z`),
  }
}

describe("selectMySummary", () => {
  it("derives profile counts from the shared domain when activity exists", () => {
    // Given
    const deps = dependencies()
    let state = reduceDemoState(
      createInitialDemoState(deps),
      { titles: ["알고리즘 문제 풀기", "러닝 30분 하기"], type: "replace_goals" },
      deps,
    )
    state = reduceDemoState(
      state,
      {
        cardId: "first-card",
        cardLabel: "독서 20분 하기",
        choice: "yes",
        crowdPercentage: 40,
        fixtureOutcome: "yes",
        roundId: state.round.id,
        stake: 100,
        type: "place_market_position",
      },
      deps,
    )
    state = reduceDemoState(state, { roundId: state.round.id, type: "settle_market_round" }, deps)
    state = reduceDemoState(
      state,
      {
        cardId: "second-card",
        cardLabel: "물 2리터 마시기",
        choice: "no",
        crowdPercentage: 25,
        fixtureOutcome: "yes",
        roundId: state.round.id,
        stake: 100,
        type: "place_market_position",
      },
      deps,
    )
    state = reduceDemoState(
      state,
      {
        catalogId: "starbucks-americano",
        cost: 1_000,
        label: "카페 아메리카노",
        type: "purchase_coupon",
      },
      deps,
    )
    const availableCoupon = state.coupons[0]
    expect(availableCoupon).toBeDefined()
    if (availableCoupon === undefined) return
    state = reduceDemoState(state, { couponId: availableCoupon.id, type: "use_coupon" }, deps)
    state = reduceDemoState(
      state,
      {
        catalogId: "cu-mobile-gift-1000",
        cost: 1_000,
        label: "CU 모바일 금액권 1천원",
        type: "purchase_coupon",
      },
      deps,
    )

    // When
    const summary = selectMySummary(state)

    // Then
    expect(summary).toMatchObject({
      availableCouponCount: 1,
      goalCount: 2,
      ledgerEntryCount: 5,
      pendingPredictionCount: 1,
      settledPredictionCount: 1,
      usedCouponCount: 1,
    })
    expect(summary.pointTransactions).toHaveLength(5)
  })
})
