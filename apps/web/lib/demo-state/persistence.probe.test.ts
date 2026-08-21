import { describe, expect, it } from "vitest"
import { createInitialDemoState, parseDemoState } from "./domain"
import {
  createDemoPersistenceSnapshot,
  DEMO_STATE_STORAGE_KEY,
  type DemoPersistenceSnapshot,
  type DemoStorage,
  demoPersistenceSchema,
  hydrateDemoState,
  resetDemoState,
  saveDemoState,
} from "./persistence"
import { reduceDemoState } from "./reducer"

const SENTINEL_KEY = "task-04-probe-sentinel"

class ProbeStorage implements DemoStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function createInitialSnapshot(): DemoPersistenceSnapshot {
  return createDemoPersistenceSnapshot(
    false,
    "",
    createInitialDemoState({
      createId: () => "unused-id",
      now: () => new Date("2026-08-21T00:00:00.000Z"),
    }),
  )
}

function createActivitySnapshot(): DemoPersistenceSnapshot {
  const ids = [
    "probe-position",
    "probe-stake",
    "probe-attendance",
    "probe-coupon",
    "probe-buy",
    "probe-market-position",
    "probe-market-stake",
    "probe-market-payout",
    "probe-round-2",
  ]
  let index = 0
  const dependencies = {
    createId: () => ids[index++] ?? "probe-exhausted",
    now: () => new Date("2026-08-21T09:00:00.000Z"),
  }
  const initial = createInitialDemoState(dependencies)
  const profiled = parseDemoState({
    ...initial,
    profile: { ...initial.profile, nickname: "프로브 사용자" },
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
    { catalogId: "probe-coffee", cost: 1_000, label: "Probe Coffee", type: "purchase_coupon" },
    dependencies,
  )
  const marketPositioned = reduceDemoState(
    purchased,
    {
      cardId: "probe-market-card",
      cardLabel: "Probe market card",
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
  return createDemoPersistenceSnapshot(true, "probe@example.test", settled)
}

describe("task 04 persistence data-surface probe", () => {
  it("prints independently parsed save, hydrate, recovery, reset, and exclusion assertions", () => {
    // Given: realistic approved activity plus every forbidden transient field
    const storage = new ProbeStorage()
    const snapshot = createActivitySnapshot()
    storage.values.set(SENTINEL_KEY, "keep-me")
    const input = {
      ...snapshot,
      apiKey: "secret",
      draft: "draft",
      evidenceFile: new Blob(["image"]),
      evidencePreviewUrl: "blob:https://example.test/probe",
      password: "password",
    }

    // When: raw storage is inspected and malformed states plus confirmed reset are exercised
    const saved = saveDemoState(storage, input)
    const hydrated = hydrateDemoState(storage, createInitialSnapshot)
    const serialized = storage.values.get(DEMO_STATE_STORAGE_KEY) ?? ""
    const independentlyParsed = demoPersistenceSchema.parse(JSON.parse(serialized))
    storage.values.set(DEMO_STATE_STORAGE_KEY, "{broken")
    const corrupt = hydrateDemoState(storage, createInitialSnapshot)
    storage.values.set(DEMO_STATE_STORAGE_KEY, JSON.stringify({ ...snapshot, version: 999 }))
    const unknown = hydrateDemoState(storage, createInitialSnapshot)
    saveDemoState(storage, snapshot)
    const reset = resetDemoState(storage)

    // Then: the machine-readable probe records exact approved, excluded, and scoped-reset facts
    const probe = {
      approved: {
        attendance: independentlyParsed.state.attendance.length,
        authenticated: independentlyParsed.authenticated,
        coupons: independentlyParsed.state.coupons.length,
        email: independentlyParsed.email,
        goals: independentlyParsed.state.goals.length,
        historyPositions: independentlyParsed.state.positions.length,
        ledger: independentlyParsed.state.ledger.length,
        marketHistory: independentlyParsed.state.marketHistory.length,
        nickname: independentlyParsed.state.profile.nickname,
        roundId: independentlyParsed.state.round.id,
        rounds: independentlyParsed.state.settledRoundIds.length + 1,
      },
      corrupt: {
        kind: corrupt.kind,
        reason: corrupt.kind === "recovered" ? corrupt.reason : null,
      },
      excluded: {
        apiKey: serialized.includes("apiKey"),
        blob: serialized.includes("Blob"),
        draft: serialized.includes("draft"),
        file: serialized.includes("evidenceFile"),
        objectUrl: serialized.includes("blob:"),
        password: serialized.includes("password"),
      },
      hydrated: hydrated.kind,
      key: DEMO_STATE_STORAGE_KEY,
      parse: `accepted_v${independentlyParsed.version}`,
      reset: reset.kind,
      saved: saved.kind,
      sentinelPreserved: storage.values.get(SENTINEL_KEY) === "keep-me",
      unknown: {
        kind: unknown.kind,
        reason: unknown.kind === "recovered" ? unknown.reason : null,
      },
    }
    console.log(`TASK_04_FOUNDATION_PROBE=${JSON.stringify(probe)}`)
    expect(probe).toEqual({
      approved: {
        attendance: 1,
        authenticated: true,
        coupons: 1,
        email: "probe@example.test",
        goals: 2,
        historyPositions: 1,
        ledger: 5,
        marketHistory: 1,
        nickname: "프로브 사용자",
        roundId: "probe-round-2",
        rounds: 2,
      },
      corrupt: { kind: "recovered", reason: "corrupt_json" },
      excluded: {
        apiKey: false,
        blob: false,
        draft: false,
        file: false,
        objectUrl: false,
        password: false,
      },
      hydrated: "hydrated",
      key: "poly-routine-demo-state:v1",
      parse: "accepted_v1",
      reset: "reset",
      saved: "saved",
      sentinelPreserved: true,
      unknown: { kind: "recovered", reason: "unknown_version" },
    })
  })
})
