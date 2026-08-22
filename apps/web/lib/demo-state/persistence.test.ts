import { describe, expect, it } from "vitest"
import { createInitialDemoState, parseDemoState } from "./domain"
import {
  createDemoPersistenceSnapshot,
  DEMO_STATE_STORAGE_KEY,
  type DemoPersistenceSnapshot,
  type DemoStorage,
  hydrateDemoState,
  resetDemoState,
  saveDemoState,
} from "./persistence"
import { reduceDemoState } from "./reducer"

const SENTINEL_KEY = "unrelated-sentinel"

type StorageFailures = Readonly<{
  read?: boolean
  remove?: boolean
  write?: boolean
}>

class MemoryStorage implements DemoStorage {
  readonly values = new Map<string, string>()

  constructor(private readonly failures: StorageFailures = {}) {}

  getItem(key: string): string | null {
    if (this.failures.read === true) throw new DOMException("blocked", "SecurityError")
    return this.values.get(key) ?? null
  }

  removeItem(key: string): void {
    if (this.failures.remove === true) throw new DOMException("blocked", "SecurityError")
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    if (this.failures.write === true) throw new DOMException("full", "QuotaExceededError")
    this.values.set(key, value)
  }
}

function realisticSnapshot(authenticated = true): DemoPersistenceSnapshot {
  const ids = [
    "position-1",
    "stake-1",
    "attendance-1",
    "coupon-1",
    "purchase-1",
    "market-position-1",
    "market-stake-1",
    "market-payout-1",
    "round-2",
  ] as const
  let idIndex = 0
  const dependencies = {
    createId: () => ids[idIndex++] ?? "exhausted-id",
    now: () => new Date("2026-08-21T09:00:00.000Z"),
  }
  const initial = createInitialDemoState(dependencies)
  const profiled = parseDemoState({
    ...initial,
    profile: { ...initial.profile, nickname: "폴리 테스터" },
  })
  const positioned = reduceDemoState(
    profiled,
    {
      choice: "yes",
      goalId: profiled.goals[0]?.id ?? "missing-goal",
      grossPayout: 167,
      roundId: profiled.round.id,
      stake: 100,
      type: "place_position",
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
    { catalogId: "coffee", cost: 1_000, label: "Coffee", type: "purchase_coupon" },
    dependencies,
  )
  const marketPositioned = reduceDemoState(
    purchased,
    {
      cardId: "market-card-1",
      cardLabel: "Morning walk succeeds",
      choice: "yes",
      crowdPercentage: 40,
      fixtureOutcome: "yes",
      roundId: purchased.round.id,
      stake: 100,
      type: "place_market_position",
    },
    dependencies,
  )
  const settled = reduceDemoState(
    marketPositioned,
    { roundId: purchased.round.id, type: "settle_market_round" },
    dependencies,
  )
  return createDemoPersistenceSnapshot(authenticated, "poly@example.test", settled)
}

function initialSnapshot(): DemoPersistenceSnapshot {
  return createDemoPersistenceSnapshot(
    false,
    "",
    createInitialDemoState({
      createId: () => "unused-id",
      now: () => new Date("2026-08-21T00:00:00.000Z"),
    }),
  )
}

describe("device-local demo persistence", () => {
  it("uses an in-memory adapter with Storage-compatible set, read, and remove behavior", () => {
    // Given: an empty in-memory adapter
    const storage = new MemoryStorage()

    // When: one key is written and then removed
    storage.setItem("key", "value")
    const stored = storage.getItem("key")
    storage.removeItem("key")

    // Then: its observable contract matches browser Storage
    expect(stored).toBe("value")
    expect(storage.getItem("key")).toBeNull()
  })

  it("round-trips approved profile and activity while omitting transient secrets", () => {
    // Given: realistic state plus forbidden transient fields at the trust boundary
    const storage = new MemoryStorage()
    const snapshot = realisticSnapshot()
    const input = {
      ...snapshot,
      apiKey: "forbidden-api-key",
      draft: "temporary goal draft",
      evidenceFile: new Blob(["image"]),
      evidencePreviewUrl: "blob:https://example.test/private-preview",
      password: "forbidden-password",
    }

    // When: the state is saved and hydrated through the adapter
    const saved = saveDemoState(storage, input)
    const hydrated = hydrateDemoState(storage, initialSnapshot)

    // Then: approved state survives and forbidden fields never enter serialized storage
    expect(saved.kind).toBe("saved")
    expect(hydrated).toEqual({ kind: "hydrated", snapshot })
    const serialized = storage.values.get(DEMO_STATE_STORAGE_KEY) ?? ""
    expect(serialized).not.toContain("password")
    expect(serialized).not.toContain("draft")
    expect(serialized).not.toContain("Blob")
    expect(serialized).not.toContain("blob:")
    expect(serialized).not.toContain("apiKey")
  })

  it("round-trips multiple listed goals with their exact deadlines and analyzed probabilities", () => {
    // Given: two completed listings with distinct user text, deadlines, and AI probabilities
    const storage = new MemoryStorage()
    const snapshot = realisticSnapshot()
    const listings = [
      {
        deadline: "2026-08-25T21:30",
        id: "listing-study",
        probability: 73,
        titles: ["정보처리기사 3장 요약"],
      },
      {
        deadline: "2026-08-27T07:15",
        id: "listing-run",
        probability: 41,
        titles: ["아침 30분 달리기"],
      },
    ]

    // When: the enriched device snapshot is saved and hydrated
    const saved = saveDemoState(storage, {
      ...snapshot,
      state: { ...snapshot.state, listedGoals: listings },
    })
    const hydrated = hydrateDemoState(storage, initialSnapshot)

    // Then: listing identity and payout inputs survive the storage boundary exactly
    expect(saved.kind).toBe("saved")
    expect(hydrated).toMatchObject({ snapshot: { state: { listedGoals: listings } } })
    expect(storage.values.get(DEMO_STATE_STORAGE_KEY)).toContain('"listing-study"')
    expect(storage.values.get(DEMO_STATE_STORAGE_KEY)).toContain('"probability":41')
  })

  it("preserves profile and activity when logout only conceals authentication", () => {
    // Given: a persisted authenticated device profile
    const storage = new MemoryStorage()
    const active = realisticSnapshot()
    saveDemoState(storage, active)
    const concealed = createDemoPersistenceSnapshot(false, active.email, active.state)

    // When: the same profile is persisted as logged out and hydrated again
    saveDemoState(storage, concealed)
    const hydrated = hydrateDemoState(storage, initialSnapshot)

    // Then: only authentication visibility changes
    expect(hydrated).toEqual({ kind: "hydrated", snapshot: concealed })
  })

  it.each([
    [
      "duplicate ledger IDs",
      (snapshot: DemoPersistenceSnapshot) => ({
        ...snapshot,
        state: {
          ...snapshot.state,
          ledger: snapshot.state.ledger.map((event, index) =>
            index === 1 ? { ...event, id: snapshot.state.ledger[0]?.id ?? event.id } : event,
          ),
        },
      }),
    ],
    [
      "a balance that disagrees with its ledger",
      (snapshot: DemoPersistenceSnapshot) => ({
        ...snapshot,
        state: { ...snapshot.state, balance: snapshot.state.balance + 1 },
      }),
    ],
  ] as const)("scoped-resets structurally valid state with %s", (_caseName, corrupt) => {
    // Given: structurally valid persisted JSON that violates a full domain invariant
    const storage = new MemoryStorage()
    storage.values.set(DEMO_STATE_STORAGE_KEY, JSON.stringify(corrupt(realisticSnapshot())))
    storage.values.set(SENTINEL_KEY, "keep-me")

    // When: hydration crosses the untrusted storage boundary
    const hydrated = hydrateDemoState(storage, initialSnapshot)

    // Then: the demo key alone is reset rather than hydrating invalid state
    expect(hydrated).toEqual({
      kind: "recovered",
      reason: "schema_mismatch",
      reset: { kind: "reset" },
      snapshot: initialSnapshot(),
    })
    expect(storage.values.get(DEMO_STATE_STORAGE_KEY)).toBeUndefined()
    expect(storage.values.get(SENTINEL_KEY)).toBe("keep-me")
  })

  it.each([
    ["corrupt_json", "{not-json"],
    ["unknown_version", JSON.stringify({ ...realisticSnapshot(), version: 2 })],
    ["schema_mismatch", JSON.stringify({ version: 1, authenticated: true })],
    ["too_large", `{"version":1,"padding":"${"x".repeat(1_000_001)}"}`],
  ] as const)("recovers initial state from %s and removes only the demo key", (reason, raw) => {
    // Given: malformed persisted input and an unrelated sentinel
    const storage = new MemoryStorage()
    storage.values.set(DEMO_STATE_STORAGE_KEY, raw)
    storage.values.set(SENTINEL_KEY, "keep-me")

    // When: hydration crosses the untrusted storage boundary
    const hydrated = hydrateDemoState(storage, initialSnapshot)

    // Then: only the demo entry resets to deterministic initial state
    expect(hydrated).toEqual({
      kind: "recovered",
      reason,
      reset: { kind: "reset" },
      snapshot: initialSnapshot(),
    })
    expect(storage.values.get(DEMO_STATE_STORAGE_KEY)).toBeUndefined()
    expect(storage.values.get(SENTINEL_KEY)).toBe("keep-me")
  })

  it("returns typed outcomes for unavailable read, write, and remove operations", () => {
    // Given: adapters that deny one operation each
    const readStorage = new MemoryStorage({ read: true })
    const writeStorage = new MemoryStorage({ write: true })
    const removeStorage = new MemoryStorage({ remove: true })
    removeStorage.values.set(DEMO_STATE_STORAGE_KEY, "{not-json")

    // When: each storage operation is attempted
    const read = hydrateDemoState(readStorage, initialSnapshot)
    const write = saveDemoState(writeStorage, realisticSnapshot())
    const remove = hydrateDemoState(removeStorage, initialSnapshot)

    // Then: no exception escapes and each outcome identifies its failed operation
    expect(read).toMatchObject({ kind: "storage_error", operation: "read" })
    expect(write).toMatchObject({ kind: "storage_error", operation: "write" })
    expect(remove).toMatchObject({
      kind: "recovered",
      reset: { kind: "storage_error", operation: "remove" },
    })
  })

  it("confirmed reset is repeatable and removes only the demo key", () => {
    // Given: persisted demo state and an unrelated sentinel
    const storage = new MemoryStorage()
    saveDemoState(storage, realisticSnapshot())
    storage.values.set(SENTINEL_KEY, "keep-me")

    // When: confirmed reset is invoked repeatedly
    const first = resetDemoState(storage)
    const replay = resetDemoState(storage)

    // Then: both removals succeed and unrelated storage remains
    expect(first).toEqual({ kind: "reset" })
    expect(replay).toEqual({ kind: "reset" })
    expect(storage.values.get(DEMO_STATE_STORAGE_KEY)).toBeUndefined()
    expect(storage.values.get(SENTINEL_KEY)).toBe("keep-me")
  })

  it("migrates an existing v1 coupon that predates purchase timestamps without losing its debit", () => {
    // Given: a previously valid v1 snapshot whose available coupon has no timestamp fields
    const storage = new MemoryStorage()
    const current = realisticSnapshot()
    const legacy = {
      ...current,
      state: {
        ...current.state,
        coupons: current.state.coupons.map(
          ({ purchasedAt: _purchasedAt, useId: _useId, usedAt: _usedAt, ...coupon }) => ({
            ...coupon,
            status: "available",
          }),
        ),
      },
    }
    storage.values.set(DEMO_STATE_STORAGE_KEY, JSON.stringify(legacy))

    // When: the current persistence boundary hydrates the old device data
    const hydrated = hydrateDemoState(storage, initialSnapshot)

    // Then: it migrates deterministically from the matching purchase ledger event
    expect(hydrated.kind).toBe("hydrated")
    if (hydrated.kind !== "hydrated") return
    expect(hydrated.snapshot.state.coupons[0]).toMatchObject({
      purchasedAt: "2026-08-21T09:00:00.000Z",
      useId: null,
      usedAt: null,
    })
    expect(hydrated.snapshot.state.ledger).toEqual(current.state.ledger)
  })

  it("defaults an older v1 snapshot without listings while preserving financial activity", () => {
    // Given: a valid v1 snapshot created before listedGoals existed
    const storage = new MemoryStorage()
    const current = realisticSnapshot()
    const { listedGoals: _listedGoals, ...legacyState } = current.state
    storage.values.set(DEMO_STATE_STORAGE_KEY, JSON.stringify({ ...current, state: legacyState }))

    // When: the current persistence boundary hydrates that snapshot
    const hydrated = hydrateDemoState(storage, initialSnapshot)

    // Then: listings default safely without losing ledger, round, positions, or coupons
    expect(hydrated.kind).toBe("hydrated")
    if (hydrated.kind !== "hydrated") return
    expect(hydrated.snapshot.state.listedGoals).toEqual([])
    expect(hydrated.snapshot.state.ledger).toEqual(current.state.ledger)
    expect(hydrated.snapshot.state.round).toEqual(current.state.round)
    expect(hydrated.snapshot.state.positions).toEqual(current.state.positions)
    expect(hydrated.snapshot.state.coupons).toEqual(current.state.coupons)
  })
})
