import { describe, expect, it } from "vitest"
import {
  createInitialDemoState,
  type DemoDependencies,
  reduceDemoState,
  selectBalance,
  validateDemoInvariants,
} from "./index"

describe("demo state invariant probe", () => {
  it("prints a deterministic data-shaped full transition", () => {
    // Given: independently specified transaction inputs and deterministic seams
    const ids = [
      "probe-position",
      "probe-stake-debit",
      "probe-payout-credit",
      "probe-attendance-credit",
      "probe-coupon",
      "probe-purchase-debit",
      "probe-coupon-use",
    ] as const
    let idIndex = 0
    const dependencies: DemoDependencies = {
      createId: () => ids[idIndex++] ?? "probe-exhausted",
      now: () => new Date("2026-08-21T09:00:00.000Z"),
    }
    const transaction = { attendance: 200, couponCost: 1_000, grossPayout: 167, stake: 100 }
    const initial = createInitialDemoState(dependencies)
    const goalId = initial.goals[0]?.id ?? "missing-goal"

    // When: stake, settlement, attendance, purchase, and coupon use execute
    const positioned = reduceDemoState(
      initial,
      {
        type: "place_position",
        roundId: initial.round.id,
        goalId,
        choice: "yes",
        stake: transaction.stake,
        grossPayout: transaction.grossPayout,
      },
      dependencies,
    )
    const settled = reduceDemoState(
      positioned,
      {
        type: "settle_round",
        roundId: initial.round.id,
        outcomes: { [goalId]: "yes" },
      },
      dependencies,
    )
    const settlementReplayed = reduceDemoState(
      settled,
      {
        type: "settle_round",
        roundId: initial.round.id,
        outcomes: { [goalId]: "yes" },
      },
      dependencies,
    )
    const attended = reduceDemoState(
      settlementReplayed,
      { type: "claim_attendance", localDate: "2026-08-21", amount: transaction.attendance },
      dependencies,
    )
    const attendanceReplayed = reduceDemoState(
      attended,
      { type: "claim_attendance", localDate: "2026-08-21", amount: transaction.attendance },
      dependencies,
    )
    const purchased = reduceDemoState(
      attendanceReplayed,
      {
        type: "purchase_coupon",
        catalogId: "probe-coffee",
        label: "Probe Coffee",
        cost: transaction.couponCost,
      },
      dependencies,
    )
    const finalState = reduceDemoState(
      purchased,
      { type: "use_coupon", couponId: "probe-coupon" },
      dependencies,
    )
    const couponUseReplayed = reduceDemoState(
      finalState,
      { type: "use_coupon", couponId: "probe-coupon" },
      dependencies,
    )

    // Then: independently calculated arithmetic and domain invariants agree
    const expectedBalance =
      51_200 -
      transaction.stake +
      transaction.grossPayout +
      transaction.attendance -
      transaction.couponCost
    const invariant = validateDemoInvariants(couponUseReplayed)
    const probe = {
      coupon: couponUseReplayed.coupons[0],
      events: couponUseReplayed.ledger.map(({ amount, direction, id }) => ({
        amount,
        direction,
        id,
      })),
      expectedBalance,
      initialBalance: selectBalance(initial),
      invariant,
      replayEventCounts: {
        attendance: [attended.ledger.length, attendanceReplayed.ledger.length],
        couponUse: [finalState.ledger.length, couponUseReplayed.ledger.length],
        settlement: [settled.ledger.length, settlementReplayed.ledger.length],
      },
      settledBalance: selectBalance(couponUseReplayed),
    }
    console.log(`TASK_01_INVARIANTS=${JSON.stringify(probe)}`)
    expect(probe.initialBalance).toBe(51_200)
    expect(probe.settledBalance).toBe(expectedBalance)
    expect(probe.coupon?.usedAt).not.toBeNull()
    expect(settlementReplayed).toBe(settled)
    expect(attendanceReplayed).toBe(attended)
    expect(couponUseReplayed).toBe(finalState)
    expect(invariant).toEqual({ valid: true, violations: [] })
  })
})
