import { describe, expect, it } from "vitest"
import { createInitialDemoState, reduceDemoState } from "./index"

function dependencies() {
  let id = 0
  return {
    createId: () => {
      id += 1
      return `integration-${id}`
    },
    now: () => new Date("2026-08-21T09:00:00.000Z"),
  }
}

describe("demo integration state", () => {
  it("stores the local profile and approved goal list in the domain", () => {
    const deps = dependencies()
    const initial = createInitialDemoState(deps)

    const profiled = reduceDemoState(
      initial,
      { nickname: "새벽 러너", type: "update_profile" },
      deps,
    )
    const goaled = reduceDemoState(
      profiled,
      { titles: ["아침 20분 달리기", "영어 단어 20개 복습하기"], type: "replace_goals" },
      deps,
    )

    expect(goaled.profile.nickname).toBe("새벽 러너")
    expect(goaled.goals.map((goal) => goal.title)).toEqual([
      "아침 20분 달리기",
      "영어 단어 20개 복습하기",
    ])
  })

  it("credits a completed goal once through the ledger", () => {
    const deps = dependencies()
    const initial = createInitialDemoState(deps)
    const goaled = reduceDemoState(
      initial,
      { titles: ["아침 20분 달리기"], type: "replace_goals" },
      deps,
    )
    const goal = goaled.goals[0]
    if (goal === undefined) throw new TypeError("goal fixture is missing")
    const action = { amount: 200, goalId: goal.id, type: "credit_goal_completion" } as const

    const credited = reduceDemoState(goaled, action, deps)
    const replayed = reduceDemoState(credited, action, deps)

    expect(credited.balance).toBe(51_400)
    expect(replayed).toEqual(credited)
  })

  it.each([1, 199, 201] as const)(
    "rejects an attendance action that attempts to credit %i points",
    (amount) => {
      // Given: an otherwise valid attendance claim with a caller-controlled reward
      const deps = dependencies()
      const initial = createInitialDemoState(deps)

      // When / Then: the domain boundary rejects anything except its exact reward
      expect(() =>
        reduceDemoState(
          initial,
          { amount, localDate: "2026-08-21", type: "claim_attendance" },
          deps,
        ),
      ).toThrow()
      expect(initial.balance).toBe(51_200)
      expect(initial.ledger).toEqual([])
    },
  )

  it("records repeat coupon instances with distinct purchase times and uses one without changing points", () => {
    // Given: a deterministic clock and enough points for two copies of one product
    let idIndex = 0
    let minute = 0
    const ids = ["coupon-a", "debit-a", "coupon-b", "debit-b", "use-a"] as const
    const deps = {
      createId: () => ids[idIndex++] ?? `unexpected-${idIndex}`,
      now: () => new Date(`2026-08-21T09:0${minute++}:00.000Z`),
    }
    const initial = createInitialDemoState(deps)

    // When: the same catalog item is purchased twice and one instance is used
    const first = reduceDemoState(
      initial,
      {
        catalogId: "repeat-fixture",
        cost: 20_000,
        label: "반복 구매 테스트 쿠폰",
        type: "purchase_coupon",
      },
      deps,
    )
    const second = reduceDemoState(
      first,
      {
        catalogId: "repeat-fixture",
        cost: 20_000,
        label: "반복 구매 테스트 쿠폰",
        type: "purchase_coupon",
      },
      deps,
    )
    const used = reduceDemoState(
      second,
      { couponId: second.coupons[0]?.id ?? "missing", type: "use_coupon" },
      deps,
    )

    // Then: both debits are exact, instances are individually addressable, and use is point-neutral
    expect(second.coupons).toHaveLength(2)
    expect(second.coupons.map((coupon) => coupon.purchasedAt)).toEqual([
      "2026-08-21T09:02:00.000Z",
      "2026-08-21T09:03:00.000Z",
    ])
    expect(new Set(second.coupons.map((coupon) => coupon.id)).size).toBe(2)
    expect(second.ledger.map((event) => [event.direction, event.amount])).toEqual([
      ["debit", 20_000],
      ["debit", 20_000],
    ])
    expect(used.balance).toBe(second.balance)
    expect(used.coupons.filter((coupon) => coupon.usedAt === null)).toHaveLength(1)
    expect(used.coupons.filter((coupon) => coupon.usedAt !== null)).toHaveLength(1)
  })
})
