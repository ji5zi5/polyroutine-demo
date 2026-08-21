import { describe, expect, it } from "vitest"
import {
  createInitialDemoState,
  type DemoDependencies,
  type DemoState,
  reduceDemoState,
} from "../demo-state/index.js"
import {
  pointShortageMessage,
  reconcilePoints,
  selectAttendanceEligibility,
  selectPointAvailability,
  selectPointTransactions,
  toBrowserLocalDateKey,
} from "./points-view-model.js"

function fixedDependencies(...ids: readonly string[]): DemoDependencies {
  let idIndex = 0
  let minute = 0
  return {
    createId: () => ids[idIndex++] ?? `generated-${idIndex}`,
    now: () => {
      const now = new Date("2026-08-21T09:00:00.000Z")
      now.setUTCMinutes(minute)
      minute += 1
      return now
    },
  }
}

function stateWithEveryPointEvent(): DemoState {
  const dependencies = fixedDependencies(
    "market-position",
    "stake-event",
    "attendance-event",
    "coupon-instance",
    "purchase-event",
    "verification-event",
    "settlement-event",
    "round-next",
  )
  const initial = createInitialDemoState(dependencies)
  const positioned = reduceDemoState(
    initial,
    {
      cardId: "card-1",
      cardLabel: "러닝 20분 하기",
      choice: "yes",
      crowdPercentage: 40,
      fixtureOutcome: "yes",
      roundId: initial.round.id,
      stake: 100,
      type: "place_market_position",
    },
    dependencies,
  )
  const attended = reduceDemoState(
    positioned,
    { amount: 200, localDate: "2026-08-21", type: "claim_attendance" },
    dependencies,
  )
  const purchased = reduceDemoState(
    attended,
    { catalogId: "coffee", cost: 1_000, label: "아메리카노", type: "purchase_coupon" },
    dependencies,
  )
  const verified = reduceDemoState(
    purchased,
    { amount: 500, goalId: initial.goals[0]?.id ?? "missing-goal", type: "credit_goal_completion" },
    dependencies,
  )
  return reduceDemoState(
    verified,
    { roundId: initial.round.id, type: "settle_market_round" },
    dependencies,
  )
}

describe("points ledger view model", () => {
  it("reconciles stake settlement verification attendance and purchase independently", () => {
    // Given: one immutable event of every current point-producing domain type
    const state = stateWithEveryPointEvent()

    // When: the history and reconciliation are projected from the ledger
    const transactions = selectPointTransactions(state)
    const reconciliation = reconcilePoints(state)
    const independentlySummed = transactions.reduce(
      (balance, transaction) => balance + transaction.signedAmount,
      state.initialBalance,
    )

    // Then: newest events lead and the independently calculated balance matches the reducer
    expect(transactions.map((transaction) => transaction.sourceType)).toEqual([
      "prediction_payout",
      "goal_completion",
      "coupon_purchase",
      "attendance",
      "prediction_stake",
    ])
    expect(transactions.map((transaction) => transaction.resultingBalance)).toEqual([
      51_050, 50_800, 50_300, 51_300, 51_100,
    ])
    expect(independentlySummed).toBe(51_050)
    expect(reconciliation).toEqual({
      calculatedBalance: 51_050,
      displayedBalance: 51_050,
      initialBalance: 51_200,
      isBalanced: true,
      transactionCount: 5,
    })
  })

  it("treats a scoped demo reset as a fresh baseline without manufacturing history", () => {
    // Given: a newly recreated state after the versioned demo key is reset
    const resetState = createInitialDemoState(fixedDependencies())

    // When: its ledger is reconciled
    const transactions = selectPointTransactions(resetState)
    const reconciliation = reconcilePoints(resetState)

    // Then: the baseline is exact and no fake reset transaction is shown
    expect(transactions).toEqual([])
    expect(reconciliation.calculatedBalance).toBe(resetState.initialBalance)
    expect(reconciliation.isBalanced).toBe(true)
    expect(reconciliation.transactionCount).toBe(0)
  })

  it("allows one claim per injected browser-local date and becomes eligible next day", () => {
    // Given: a browser-local date close to midnight and an unclaimed state
    const dependencies = fixedDependencies("attendance-day-one", "attendance-day-two")
    const initial = createInitialDemoState(dependencies)
    const dayOne = new Date(2026, 7, 21, 23, 59)
    const firstEligibility = selectAttendanceEligibility(initial, dayOne)
    if (firstEligibility.kind !== "eligible") throw new TypeError("Expected day-one eligibility")
    const claimed = reduceDemoState(initial, firstEligibility.action, dependencies)

    // When: a rapid replay occurs and the injected clock crosses local midnight
    const replayed = reduceDemoState(claimed, firstEligibility.action, dependencies)
    const dayTwo = new Date(2026, 7, 22, 0, 1)
    const sameDayEligibility = selectAttendanceEligibility(replayed, dayOne)
    const nextDayEligibility = selectAttendanceEligibility(replayed, dayTwo)

    // Then: the replay is a no-op while the new local calendar day is claimable
    expect(toBrowserLocalDateKey(dayOne)).toBe("2026-08-21")
    expect(replayed).toBe(claimed)
    expect(replayed.ledger).toHaveLength(1)
    expect(sameDayEligibility.kind).toBe("claimed")
    expect(nextDayEligibility).toMatchObject({ kind: "eligible", localDate: "2026-08-22" })
  })

  it("states required held and shortfall points without mutating the balance", () => {
    // Given: a 60P balance facing the fixed 100P prediction stake
    // When: availability and its navigating copy are selected
    const availability = selectPointAvailability(60, 100)
    const message = pointShortageMessage(availability)

    // Then: all three exact values are carried in the typed result and copy
    expect(availability).toEqual({ held: 60, kind: "insufficient", required: 100, shortfall: 40 })
    expect(message).toBe("100P 필요 · 보유 60P · 40P 부족")
  })
})
