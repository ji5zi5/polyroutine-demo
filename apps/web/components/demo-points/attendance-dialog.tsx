"use client"

import { createElement as h, type SyntheticEvent } from "react"
import type { AttendanceCalendarMonth } from "../../lib/demo-points/attendance-calendar"
import type { AttendanceEligibility } from "../../lib/demo-points/points-view-model"
import { ATTENDANCE_CREDIT_POINTS, type DemoAction } from "../../lib/demo-state/index"
import { useModalDialog } from "../demo-shop/use-modal-dialog"
import styles from "./demo-points.module.css"

type AttendanceDialogProps = Readonly<{
  calendar: AttendanceCalendarMonth
  eligibility: AttendanceEligibility
  onClaim: (action: Extract<DemoAction, { readonly type: "claim_attendance" }>) => void
  onClose: () => void
}>

const weekdays = ["일", "월", "화", "수", "목", "금", "토"] as const
const points = new Intl.NumberFormat("ko-KR")

function dayAccessibilityLabel(
  month: number,
  day: AttendanceCalendarMonth["days"][number],
): string {
  if (day.status === "claimed") return `${month}월 ${day.day}일, 내 출석 기록`
  return `${month}월 ${day.day}일`
}

export function AttendanceDialog({
  calendar,
  eligibility,
  onClaim,
  onClose,
}: AttendanceDialogProps) {
  const dialogRef = useModalDialog()
  const isClaimed = eligibility.kind === "claimed"
  const leadingCells = Array.from({ length: calendar.leadingBlankCount }, (_, index) =>
    h("td", { "aria-hidden": true, key: `leading-${index + 1}` }),
  )
  const dayCells = calendar.days.map((day) =>
    h(
      "td",
      {
        "aria-current": day.isToday ? "date" : undefined,
        "aria-label": dayAccessibilityLabel(calendar.month, day),
        "data-attendance-status": day.status,
        key: day.localDate,
      },
      h("span", null, day.day),
      day.status === "none" ? null : h("small", null, "출석"),
    ),
  )
  const cells = [...leadingCells, ...dayCells]
  const rows = Array.from({ length: Math.ceil(cells.length / weekdays.length) }, (_, index) =>
    h(
      "tr",
      { key: `week-${index + 1}` },
      ...cells.slice(index * weekdays.length, (index + 1) * weekdays.length),
    ),
  )
  return h(
    "dialog",
    {
      "aria-labelledby": "demo-attendance-title",
      "aria-modal": true,
      className: styles["dialog"],
      id: "demo-attendance-dialog",
      onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault()
        onClose()
      },
      ref: dialogRef,
    },
    h(
      "header",
      { className: styles["dialogHeading"] },
      h("span", null, "매일 한 번 받을 수 있어요"),
      h("h2", { id: "demo-attendance-title" }, `${calendar.month}월 출석체크`),
    ),
    h(
      "table",
      { className: styles["calendar"] },
      h("caption", { className: styles["visuallyHidden"] }, `${calendar.monthLabel} 출석 달력`),
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          ...weekdays.map((weekday) => h("th", { key: weekday, scope: "col" }, weekday)),
        ),
      ),
      h("tbody", null, ...rows),
    ),
    h(
      "div",
      { className: styles["dialogActions"] },
      h(
        "button",
        {
          className: styles["primaryAction"],
          disabled: isClaimed,
          onClick: () => {
            if (eligibility.kind === "eligible") onClaim(eligibility.action)
          },
          type: "button",
        },
        isClaimed
          ? `오늘 출석 완료 · +${points.format(ATTENDANCE_CREDIT_POINTS)}P`
          : `오늘 출석하기 · +${points.format(ATTENDANCE_CREDIT_POINTS)}P`,
      ),
      h(
        "button",
        { className: styles["secondaryAction"], onClick: onClose, type: "button" },
        "닫기",
      ),
    ),
  )
}
