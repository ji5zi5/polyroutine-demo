const PREDICTION_WINDOW_MILLISECONDS = 30 * 60 * 1_000
const EVIDENCE_WINDOW_MILLISECONDS = 12 * 60 * 60 * 1_000

export type GoalSchedule = {
  readonly evidenceDeadlineAt: Date
  readonly predictionCutoffAt: Date
}

export function calculateGoalSchedule(serverNow: Date): GoalSchedule {
  return {
    evidenceDeadlineAt: new Date(serverNow.getTime() + EVIDENCE_WINDOW_MILLISECONDS),
    predictionCutoffAt: new Date(serverNow.getTime() + PREDICTION_WINDOW_MILLISECONDS),
  }
}

export function localDateAt(serverNow: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(serverNow)
  let day = ""
  let month = ""
  let year = ""
  for (const part of parts) {
    if (part.type === "day") day = part.value
    if (part.type === "month") month = part.value
    if (part.type === "year") year = part.value
  }
  if (day === "" || month === "" || year === "") {
    throw new RangeError("date formatter omitted a required part")
  }
  return `${year}-${month}-${day}`
}
