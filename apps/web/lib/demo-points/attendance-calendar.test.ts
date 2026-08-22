import { describe, expect, it } from "vitest"
import {
  createInitialDemoState,
  type DemoDependencies,
  reduceDemoState,
} from "../demo-state/index.js"
import { selectAttendanceCalendar } from "./attendance-calendar.js"

const dependencies: DemoDependencies = {
  createId: () => "attendance-calendar-event",
  now: () => new Date("2026-08-21T09:00:00.000Z"),
}

describe("attendance calendar view model", () => {
  it("projects only actual browser-local attendance claims", () => {
    // Given: a fixed August claim
    const initial = createInitialDemoState(dependencies)
    const claimed = reduceDemoState(
      initial,
      { amount: 200, localDate: "2026-08-21", type: "claim_attendance" },
      dependencies,
    )

    // When: the current browser-local month is projected
    const calendar = selectAttendanceCalendar(claimed, new Date(2026, 7, 21, 12))

    // Then: only actual history is projected
    expect(calendar.monthLabel).toBe("2026년 8월")
    expect(calendar.leadingBlankCount).toBe(6)
    expect(calendar.days).toHaveLength(31)
    expect(calendar.days.find((day) => day.day === 17)?.status).toBe("none")
    expect(calendar.days.find((day) => day.day === 21)).toMatchObject({
      isToday: true,
      localDate: "2026-08-21",
      status: "claimed",
    })
  })
})
