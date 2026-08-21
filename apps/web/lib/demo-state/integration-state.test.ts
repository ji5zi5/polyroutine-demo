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
})
