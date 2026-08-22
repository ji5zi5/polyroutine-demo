import { createElement as h } from "react"
import { selectAttendanceCalendar } from "../../lib/demo-points/attendance-calendar"
import {
  selectAttendanceEligibility,
  selectPointTransactions,
} from "../../lib/demo-points/points-view-model"
import type { DemoAction, DemoState } from "../../lib/demo-state/index"
import { AttendanceDialog } from "./attendance-dialog"
import styles from "./demo-points.module.css"
import { TransactionHistory } from "./transaction-history"

export type DemoPointsSurfaceProps = Readonly<{
  attendanceDialogOpen: boolean
  defaultHistoryExpanded?: boolean
  now: Date
  onClaimAttendance: (action: Extract<DemoAction, { readonly type: "claim_attendance" }>) => void
  onCloseAttendance: () => void
  onOpenAttendance: () => void
  settled?: boolean
  state: DemoState
}>

const points = new Intl.NumberFormat("ko-KR")

export function DemoPointsSurface({
  attendanceDialogOpen,
  defaultHistoryExpanded = false,
  now,
  onClaimAttendance,
  onCloseAttendance,
  onOpenAttendance,
  settled = false,
  state,
}: DemoPointsSurfaceProps) {
  const eligibility = selectAttendanceEligibility(state, now)
  const transactions = selectPointTransactions(state)
  const attendanceDialog = attendanceDialogOpen
    ? h(AttendanceDialog, {
        calendar: selectAttendanceCalendar(state, now),
        eligibility,
        onClaim: onClaimAttendance,
        onClose: onCloseAttendance,
      })
    : null
  return h(
    "section",
    { "aria-labelledby": "demo-points-title", className: styles["surface"] },
    h(
      "header",
      { "data-points-settled": settled, className: styles["balance"] },
      h(
        "div",
        null,
        h("span", null, "보유 포인트"),
        h(
          "h2",
          { "data-points-balance": state.balance, id: "demo-points-title" },
          `${points.format(state.balance)}점`,
        ),
      ),
      h(
        "button",
        {
          "aria-controls": "demo-attendance-dialog",
          "aria-expanded": attendanceDialogOpen,
          "aria-haspopup": "dialog",
          className: styles["attendanceAction"],
          onClick: onOpenAttendance,
          type: "button",
        },
        eligibility.kind === "claimed" ? "오늘 출석 완료" : "출석체크",
      ),
    ),
    h(TransactionHistory, { defaultExpanded: defaultHistoryExpanded, transactions }),
    attendanceDialog,
  )
}
