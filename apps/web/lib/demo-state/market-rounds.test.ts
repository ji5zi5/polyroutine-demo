import { describe, expect, it } from "vitest"
import {
  calculateGrossPayout,
  createInitialDemoState,
  type DemoDependencies,
  type DemoState,
  demoActionSchema,
  placeMarketPosition,
  reduceDemoState,
  selectBalance,
  selectMarketRoundHistory,
  selectPendingMarketPositions,
} from "./index"

function fixedDependencies(...ids: readonly string[]): DemoDependencies {
  let index = 0
  return {
    createId: () => ids[index++] ?? "exhausted-id",
    now: () => new Date("2026-08-21T09:00:00.000Z"),
  }
}

function placeAction(state: DemoState, choice: "no" | "yes" = "yes") {
  return {
    cardId: "<script>alert('card')</script>",
    cardLabel: "외부 카드 <img src=x onerror=alert(1)>",
    choice,
    crowdPercentage: choice === "yes" ? 64 : 36,
    fixtureOutcome: "yes" as const,
    roundId: state.round.id,
    stake: 100 as const,
    type: "place_market_position" as const,
  }
}

describe("repeatable prediction rounds", () => {
  it("removes the legacy global lock by opening a fresh round after settlement", () => {
    // Given: one legacy prototype-compatible position
    const dependencies = fixedDependencies(
      "legacy-position",
      "legacy-stake",
      "legacy-payout",
      "next-position",
      "next-stake",
    )
    const initial = createInitialDemoState(dependencies)
    const goalId = initial.goals[0]?.id ?? "missing-goal"
    const positioned = reduceDemoState(
      initial,
      {
        choice: "yes",
        goalId,
        grossPayout: 167,
        roundId: initial.round.id,
        stake: 100,
        type: "place_position",
      },
      dependencies,
    )

    // When: it settles and the successor round receives another position
    const settled = reduceDemoState(
      positioned,
      { outcomes: { [goalId]: "yes" }, roundId: initial.round.id, type: "settle_round" },
      dependencies,
    )
    const next = reduceDemoState(
      settled,
      {
        choice: "no",
        goalId,
        grossPayout: 200,
        roundId: settled.round.id,
        stake: 100,
        type: "place_position",
      },
      dependencies,
    )

    // Then: the old batch is cleared and participation remains open
    expect(settled.round.status).toBe("open")
    expect(settled.round.id).not.toBe(initial.round.id)
    expect(next.positions).toHaveLength(1)
  })

  it("snapshots inverse odds and permits repeated positions on the same card", () => {
    // Given: a fixed open round and one card
    const dependencies = fixedDependencies("position-1", "stake-1", "position-2", "stake-2")
    const initial = createInitialDemoState(dependencies)

    // When: the same card receives two 100P positions
    const once = reduceDemoState(initial, placeAction(initial), dependencies)
    const twice = reduceDemoState(once, placeAction(once), dependencies)

    // Then: each immutable position keeps the card, choice, odds, round, and time snapshot
    expect(calculateGrossPayout(100, 64)).toBe(157)
    expect(selectPendingMarketPositions(twice)).toEqual([
      expect.objectContaining({
        cardId: "<script>alert('card')</script>",
        choice: "yes",
        crowdPercentage: 64,
        grossPayout: 157,
        placedAt: "2026-08-21T09:00:00.000Z",
        roundId: initial.round.id,
        stake: 100,
      }),
      expect.objectContaining({ cardId: "<script>alert('card')</script>", grossPayout: 157 }),
    ])
    expect(selectBalance(twice)).toBe(51_000)
  })

  it("keeps skip neutral and returns typed insufficient-funds details", () => {
    // Given: a valid state holding fewer than the fixed 100P stake
    const dependencies = fixedDependencies()
    const initial = createInitialDemoState(dependencies)
    const poor = { ...initial, balance: 60, initialBalance: 60 }

    // When: one card is skipped and another position is attempted
    const skipped = reduceDemoState(
      poor,
      { cardId: "card-skip", type: "skip_market_card" },
      dependencies,
    )
    const outcome = placeMarketPosition(skipped, placeAction(skipped), dependencies)

    // Then: skip writes nothing and the failure explains the exact gap
    expect(skipped).toBe(poor)
    expect(skipped.ledger).toEqual([])
    expect(skipped.positions).toEqual([])
    expect(outcome).toEqual({
      held: 60,
      kind: "insufficient_funds",
      required: 100,
      shortfall: 40,
      state: skipped,
    })
  })

  it("archives the pending batch once and opens an immediately usable round", () => {
    // Given: one winning and one losing position in the current batch
    const dependencies = fixedDependencies(
      "position-win",
      "stake-win",
      "position-loss",
      "stake-loss",
      "payout-win",
      "round-2",
      "position-next",
      "stake-next",
    )
    const initial = createInitialDemoState(dependencies)
    const winning = reduceDemoState(initial, placeAction(initial, "yes"), dependencies)
    const pending = reduceDemoState(winning, placeAction(winning, "no"), dependencies)
    const settleAction = { roundId: initial.round.id, type: "settle_market_round" } as const

    // When: settlement is rapidly replayed and the next round receives a position
    const settled = reduceDemoState(pending, settleAction, dependencies)
    const replayed = reduceDemoState(settled, settleAction, dependencies)
    const next = reduceDemoState(replayed, placeAction(replayed, "yes"), dependencies)

    // Then: only the correct gross payout is credited and all positions are archived by round
    expect(replayed).toBe(settled)
    expect(settled.round).toEqual({
      id: "round-2",
      openedAt: "2026-08-21T09:00:00.000Z",
      status: "open",
    })
    expect(selectBalance(settled)).toBe(51_157)
    expect(settled.ledger.map((event) => [event.direction, event.amount])).toEqual([
      ["debit", 100],
      ["debit", 100],
      ["credit", 157],
    ])
    expect(selectMarketRoundHistory(settled)).toEqual([
      expect.objectContaining({ roundId: "round-1", totalPayout: 157, totalStake: 200 }),
    ])
    expect(settled.marketHistory.map((position) => [position.result, position.payout])).toEqual([
      ["won", 157],
      ["lost", 0],
    ])
    expect(selectPendingMarketPositions(next)).toHaveLength(1)
  })

  it.each([
    { ...placeAction(createInitialDemoState(fixedDependencies())), cardId: "" },
    { ...placeAction(createInitialDemoState(fixedDependencies())), choice: "maybe" },
    { ...placeAction(createInitialDemoState(fixedDependencies())), crowdPercentage: 0 },
    { ...placeAction(createInitialDemoState(fixedDependencies())), crowdPercentage: 100 },
    { ...placeAction(createInitialDemoState(fixedDependencies())), stake: 99 },
  ])("rejects malformed market input %#", (input) => {
    // Given: malformed external card/choice/percentage/stake data
    // When: the action boundary parses it
    const result = demoActionSchema.safeParse(input)

    // Then: no malformed position enters the reducer
    expect(result.success).toBe(false)
  })
})
