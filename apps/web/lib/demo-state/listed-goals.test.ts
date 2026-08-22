import { describe, expect, it } from "vitest"
import { createInitialDemoState, DemoDomainError, parseDemoState } from "./domain"
import { reduceDemoState } from "./reducer"

function dependencies(...ids: readonly string[]) {
  let index = 0
  return {
    createId: () => ids[index++] ?? "exhausted-id",
    now: () => new Date("2026-08-23T00:00:00.000Z"),
  }
}

describe("listed goal state", () => {
  it("keeps multiple listings stable while updating one deadline", () => {
    // Given: two analyzed goal batches listed with distinct payout inputs
    const fixture = dependencies("listing-study", "listing-run")
    const initial = createInitialDemoState(fixture)
    const first = reduceDemoState(
      initial,
      {
        deadline: "2026-08-25T21:30",
        probability: 73,
        titles: ["정보처리기사 3장 요약"],
        type: "list_goals",
      },
      fixture,
    )
    const second = reduceDemoState(
      first,
      {
        deadline: "2026-08-27T07:15",
        probability: 41,
        titles: ["아침 30분 달리기"],
        type: "list_goals",
      },
      fixture,
    )

    // When: only the first listing deadline is edited
    const updated = reduceDemoState(
      second,
      {
        deadline: "2026-08-26T06:45",
        listingId: "listing-study",
        type: "update_listed_goal_deadline",
      },
      fixture,
    )

    // Then: IDs, text, probabilities, and the untouched listing remain exact
    expect(updated.listedGoals).toEqual([
      {
        deadline: "2026-08-26T06:45",
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
    ])
  })

  it("fails closed for duplicate listing IDs and stale listing edits", () => {
    // Given: one listed goal whose ID is allocated already
    const initial = createInitialDemoState(dependencies())
    const listed = reduceDemoState(
      initial,
      {
        deadline: "2026-08-25T21:30",
        probability: 73,
        titles: ["정보처리기사 3장 요약"],
        type: "list_goals",
      },
      dependencies("listing-1"),
    )

    // When: another listing reuses its ID or an absent listing is edited
    const duplicate = () =>
      reduceDemoState(
        listed,
        {
          deadline: "2026-08-27T07:15",
          probability: 41,
          titles: ["아침 30분 달리기"],
          type: "list_goals",
        },
        dependencies("listing-1"),
      )
    const staleEdit = () =>
      reduceDemoState(
        listed,
        {
          deadline: "2026-08-28T09:00",
          listingId: "missing-listing",
          type: "update_listed_goal_deadline",
        },
        dependencies(),
      )

    // Then: neither invalid change can enter the state
    expect(duplicate).toThrowError(DemoDomainError)
    expect(staleEdit).toThrowError(DemoDomainError)
    expect(listed.listedGoals).toHaveLength(1)
  })

  it.each([
    { deadline: "not-a-date", probability: 73, titles: ["정상 목표"] },
    { deadline: "2026-08-25T21:30", probability: 101, titles: ["정상 목표"] },
    { deadline: "2026-08-25T21:30", probability: 73, titles: ["중복 목표", "중복 목표"] },
  ])("rejects malformed persisted listing input %#", (listing) => {
    // Given: a valid state with one malformed untrusted listing
    const initial = createInitialDemoState(dependencies())

    // When: the persistence-domain boundary parses it
    const parsed = () =>
      parseDemoState({ ...initial, listedGoals: [{ ...listing, id: "listing-invalid" }] })

    // Then: malformed payout or identity inputs fail closed
    expect(parsed).toThrow()
  })

  it.each(["2026-99-99T99:99", "2026-02-30T12:00", "2026-02-29T12:00", "2026-08-25T24:00"])(
    "rejects impossible datetime-local calendar value %s",
    (deadline) => {
      // Given: a datetime-local string with the right digit shape but impossible calendar fields
      const initial = createInitialDemoState(dependencies())

      // When: the persistence-domain boundary parses the listing
      const parsed = () =>
        parseDemoState({
          ...initial,
          listedGoals: [
            { deadline, id: "listing-invalid-date", probability: 73, titles: ["정상 목표"] },
          ],
        })

      // Then: permissive date normalization cannot admit it
      expect(parsed).toThrow()
    },
  )

  it("accepts an exact-minute leap-day datetime-local value", () => {
    // Given: a valid leap-day deadline in the persisted minute-precision format
    const initial = createInitialDemoState(dependencies())

    // When: the persistence-domain boundary parses it without timezone conversion
    const parsed = parseDemoState({
      ...initial,
      listedGoals: [
        {
          deadline: "2028-02-29T23:59",
          id: "listing-leap-day",
          probability: 73,
          titles: ["윤년 목표"],
        },
      ],
    })

    // Then: the exact local minute string remains unchanged
    expect(parsed.listedGoals[0]?.deadline).toBe("2028-02-29T23:59")
  })
})
