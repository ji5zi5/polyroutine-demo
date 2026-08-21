import { describe, expect, it } from "vitest"
import { couponInstanceSchema } from "../demo-coupons/coupon-types"
import {
  createInitialDemoState,
  type DemoDependencies,
  DemoDomainError,
  type DemoState,
  demoActionSchema,
  demoStateSchema,
  reduceDemoState,
  selectBalance,
  validateDemoInvariants,
} from "./index"

function fixedDependencies(...ids: readonly string[]): DemoDependencies {
  let index = 0
  return {
    createId: () => ids[index++] ?? "exhausted-id",
    now: () => new Date("2026-08-21T09:00:00.000Z"),
  }
}

describe("version 1 demo state", () => {
  it("creates the device-local 51,200P initial state", () => {
    // Given: deterministic local dependencies
    const dependencies = fixedDependencies()

    // When: the initial state is created
    const state = createInitialDemoState(dependencies)

    // Then: its versioned local profile, goals, round, and balance are ready
    expect(demoStateSchema.parse(state)).toEqual(state)
    expect(state.version).toBe(1)
    expect(state.profile.scope).toBe("device-local")
    expect(state.goals.length).toBeGreaterThan(0)
    expect(state.round.status).toBe("open")
    expect(selectBalance(state)).toBe(51_200)
  })

  it("keeps the points ledger immutable while settling gross payout once", () => {
    // Given: a 100P position whose gross payout is 167P
    const dependencies = fixedDependencies("position-1", "debit-1", "credit-1")
    const initial = createInitialDemoState(dependencies)
    const positioned = reduceDemoState(
      initial,
      {
        type: "place_position",
        roundId: initial.round.id,
        goalId: initial.goals[0]?.id ?? "missing-goal",
        choice: "yes",
        stake: 100,
        grossPayout: 167,
      },
      dependencies,
    )

    // When: the matching outcome settles the round
    const settled = reduceDemoState(
      positioned,
      {
        type: "settle_round",
        roundId: initial.round.id,
        outcomes: { [initial.goals[0]?.id ?? "missing-goal"]: "yes" },
      },
      dependencies,
    )

    // Then: stake and payout are separate immutable ledger events
    expect(initial.ledger).toEqual([])
    expect(positioned.ledger.map((event) => [event.id, event.direction, event.amount])).toEqual([
      ["debit-1", "debit", 100],
    ])
    expect(settled.ledger.map((event) => [event.id, event.direction, event.amount])).toEqual([
      ["debit-1", "debit", 100],
      ["credit-1", "credit", 167],
    ])
    expect(selectBalance(settled)).toBe(51_267)
    expect(validateDemoInvariants(settled)).toEqual({ valid: true, violations: [] })
  })

  it("credits attendance only once per local date", () => {
    // Given: an unclaimed local date
    const dependencies = fixedDependencies("attendance-1", "attendance-replay")
    const initial = createInitialDemoState(dependencies)
    const claimed = reduceDemoState(
      initial,
      { type: "claim_attendance", localDate: "2026-08-21", amount: 200 },
      dependencies,
    )

    // When: the same local date is replayed
    const replayed = reduceDemoState(
      claimed,
      { type: "claim_attendance", localDate: "2026-08-21", amount: 200 },
      dependencies,
    )

    // Then: the achieved state is returned without a second credit
    expect(replayed).toBe(claimed)
    expect(replayed.ledger).toHaveLength(1)
    expect(selectBalance(replayed)).toBe(51_400)
  })

  it("allows each coupon instance to be used once", () => {
    // Given: an affordable purchased coupon instance
    const dependencies = fixedDependencies("coupon-1", "purchase-1", "coupon-use-1")
    const initial = createInitialDemoState(dependencies)
    const purchased = reduceDemoState(
      initial,
      { type: "purchase_coupon", catalogId: "coffee", label: "Coffee", cost: 1_000 },
      dependencies,
    )
    const used = reduceDemoState(
      purchased,
      { type: "use_coupon", couponId: "coupon-1" },
      dependencies,
    )

    // When: the same coupon is used again
    const replayed = reduceDemoState(
      used,
      { type: "use_coupon", couponId: "coupon-1" },
      dependencies,
    )

    // Then: its achieved single-use state and original purchase debit remain stable
    expect(replayed).toBe(used)
    expect(replayed.coupons[0]?.usedAt).toBe("2026-08-21T09:00:00.000Z")
    expect(replayed.ledger).toHaveLength(1)
    expect(selectBalance(replayed)).toBe(50_200)
  })
})

describe("demo domain adversarial inputs", () => {
  it.each([
    { version: 1 },
    { type: "claim_attendance", localDate: "not-a-date", amount: 200 },
    { type: "claim_attendance", localDate: "2026-08-21", amount: -1 },
    { type: "unknown_action" },
  ])("rejects malformed boundary input %#", (input) => {
    // Given: untrusted malformed input
    // When: the versioned/action boundary parses it
    const parsed =
      "version" in input ? demoStateSchema.safeParse(input) : demoActionSchema.safeParse(input)

    // Then: it is rejected rather than entering the domain
    expect(parsed.success).toBe(false)
  })

  it("rejects an otherwise valid state with an unsupported version", () => {
    // Given: a valid version 1 state changed only at its version boundary
    const initial = createInitialDemoState(fixedDependencies())

    // When: version 2 is parsed
    const parsed = demoStateSchema.safeParse({ ...initial, version: 2 })

    // Then: the unsupported version is rejected
    expect(parsed.success).toBe(false)
  })

  it("rejects a debit that would make the balance negative", () => {
    // Given: a coupon more expensive than the current balance
    const dependencies = fixedDependencies("coupon-1", "debit-1")
    const initial = createInitialDemoState(dependencies)

    // When: purchase is attempted
    const purchase = () =>
      reduceDemoState(
        initial,
        { type: "purchase_coupon", catalogId: "impossible", label: "Impossible", cost: 51_201 },
        dependencies,
      )

    // Then: the negative balance is refused
    expect(purchase).toThrowError(DemoDomainError)
  })

  it("makes settlement replay a no-op but rejects duplicate generated event IDs", () => {
    // Given: a settled round
    const dependencies = fixedDependencies("position-1", "same-event", "credit-1")
    const initial = createInitialDemoState(dependencies)
    const positioned = reduceDemoState(
      initial,
      {
        type: "place_position",
        roundId: initial.round.id,
        goalId: initial.goals[0]?.id ?? "missing-goal",
        choice: "yes",
        stake: 100,
        grossPayout: 167,
      },
      dependencies,
    )
    const settled = reduceDemoState(
      positioned,
      { type: "settle_round", roundId: initial.round.id, outcomes: {} },
      dependencies,
    )

    // When: settlement and an already-issued ID are replayed
    const settlementReplay = reduceDemoState(
      settled,
      { type: "settle_round", roundId: initial.round.id, outcomes: {} },
      dependencies,
    )
    const duplicateIdDependencies = fixedDependencies("position-2", "same-event")
    const eventReplay = () =>
      reduceDemoState(
        positioned,
        {
          type: "place_position",
          roundId: initial.round.id,
          goalId: initial.goals[0]?.id ?? "missing-goal",
          choice: "no",
          stake: 100,
          grossPayout: 200,
        },
        duplicateIdDependencies,
      )

    // Then: the achieved settlement stays unchanged while a conflicting ID fails closed
    expect(settlementReplay).toBe(settled)
    expect(settlementReplay.ledger).toEqual(settled.ledger)
    expect(eventReplay).toThrowError(DemoDomainError)
  })

  it("detects a ledger whose stated balance cannot be independently reconciled", () => {
    // Given: a valid state shape with a tampered cached balance
    const initial = createInitialDemoState(fixedDependencies())
    const tampered: DemoState = { ...initial, balance: initial.balance + 1 }

    // When: invariants are checked
    const result = validateDemoInvariants(tampered)

    // Then: independent ledger reconciliation reports the mismatch
    expect(result.valid).toBe(false)
    expect(result.violations).toContain("balance_mismatch")
  })

  it("rejects a purchase atomically when coupon and debit allocators return the same ID", () => {
    // Given: a valid state and an allocator that repeats one ID across entity categories
    const initial = createInitialDemoState(fixedDependencies())
    const duplicateDependencies = fixedDependencies("same-purchase-id", "same-purchase-id")

    // When: a coupon purchase tries to allocate its instance and debit
    const purchase = () =>
      reduceDemoState(
        initial,
        { catalogId: "coffee", cost: 1_000, label: "Coffee", type: "purchase_coupon" },
        duplicateDependencies,
      )

    // Then: the transaction fails closed without changing the caller-owned state
    expect(purchase).toThrowError(DemoDomainError)
    expect(initial.balance).toBe(51_200)
    expect(initial.coupons).toEqual([])
    expect(initial.ledger).toEqual([])
  })

  it("detects an identity reused across coupon and ledger categories", () => {
    // Given: a structurally valid purchase whose coupon identity is tampered to equal its debit ID
    const dependencies = fixedDependencies("coupon-1", "debit-1")
    const purchased = reduceDemoState(
      createInitialDemoState(dependencies),
      { catalogId: "coffee", cost: 1_000, label: "Coffee", type: "purchase_coupon" },
      dependencies,
    )
    const coupon = purchased.coupons[0]
    const debit = purchased.ledger[0]
    if (coupon === undefined || debit === undefined) throw new TypeError("purchase fixture missing")
    const collided: DemoState = {
      ...purchased,
      coupons: [couponInstanceSchema.parse({ ...coupon, id: debit.id })],
    }

    // When: full domain invariants inspect the state
    const result = validateDemoInvariants(collided)

    // Then: a cross-category collision is explicit even though each category is unique alone
    expect(result.valid).toBe(false)
    expect(result.violations).toContain("duplicate_allocated_id")
  })
})
