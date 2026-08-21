import type { DemoState } from "../demo-state/index"
import { toBrowserLocalDateKey } from "./points-view-model"

export const SEEDED_ATTENDANCE_EXAMPLE_DATES = ["2026-08-17", "2026-08-18", "2026-08-19"] as const

export type AttendanceCalendarDay = Readonly<{
  day: number
  isToday: boolean
  localDate: string
  status: "claimed" | "example" | "none"
}>

export type AttendanceCalendarMonth = Readonly<{
  days: readonly AttendanceCalendarDay[]
  leadingBlankCount: number
  month: number
  monthLabel: string
  year: number
}>

export function selectAttendanceCalendar(
  state: DemoState,
  now: Date,
  exampleDates: readonly string[] = SEEDED_ATTENDANCE_EXAMPLE_DATES,
): AttendanceCalendarMonth {
  const year = now.getFullYear()
  const monthIndex = now.getMonth()
  const month = monthIndex + 1
  const today = toBrowserLocalDateKey(now)
  const actualDates = new Set(state.attendance.map((claim) => claim.localDate))
  const illustrativeDates = new Set(exampleDates)
  const daysInMonth = new Date(year, month, 0, 12).getDate()
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1
    const localDate = toBrowserLocalDateKey(new Date(year, monthIndex, day, 12))
    let status: AttendanceCalendarDay["status"] = "none"
    if (actualDates.has(localDate)) status = "claimed"
    else if (illustrativeDates.has(localDate)) status = "example"
    return { day, isToday: localDate === today, localDate, status }
  })
  return {
    days,
    leadingBlankCount: new Date(year, monthIndex, 1, 12).getDay(),
    month,
    monthLabel: `${year}년 ${month}월`,
    year,
  }
}
