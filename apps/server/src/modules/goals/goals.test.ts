import { describe, expect, it } from "vitest"
import { calculateGoalSchedule } from "./schedule.js"

describe("goals schedule", () => {
  it("derives canonical cutoff and deadline from the server clock", () => {
    // Given
    const serverNow = new Date("2026-08-19T00:00:00.000Z")

    // When
    const schedule = calculateGoalSchedule(serverNow)

    // Then
    expect(schedule).toEqual({
      evidenceDeadlineAt: new Date("2026-08-19T12:00:00.000Z"),
      predictionCutoffAt: new Date("2026-08-19T00:30:00.000Z"),
    })
  })
})
