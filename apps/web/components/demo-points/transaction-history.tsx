import { createElement as h } from "react"
import type { PointTransaction } from "../../lib/demo-points/points-view-model"
import styles from "./demo-points.module.css"

type TransactionHistoryProps = Readonly<{
  defaultExpanded?: boolean
  transactions: readonly PointTransaction[]
}>

const points = new Intl.NumberFormat("ko-KR")
const dateTime = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "short",
  timeStyle: "short",
})

function signedPoints(transaction: PointTransaction): string {
  const sign = transaction.direction === "credit" ? "+" : "−"
  return `${sign}${points.format(transaction.amount)}P`
}

export function TransactionHistory({
  defaultExpanded = false,
  transactions,
}: TransactionHistoryProps) {
  if (transactions.length === 0) return null
  const content = h(
    "ol",
    { className: styles["transactionList"] },
    ...transactions.map((transaction) =>
      h(
        "li",
        { className: styles["transaction"], key: transaction.eventId },
        h(
          "div",
          { className: styles["transactionIdentity"] },
          h("strong", null, transaction.label),
          h(
            "time",
            { dateTime: transaction.occurredAt },
            dateTime.format(new Date(transaction.occurredAt)),
          ),
        ),
        h(
          "div",
          { className: styles["transactionAmount"] },
          h("strong", { "data-direction": transaction.direction }, signedPoints(transaction)),
          h("span", null, `결과 잔액 ${points.format(transaction.resultingBalance)}P`),
        ),
      ),
    ),
  )
  return h(
    "details",
    { className: styles["history"], open: defaultExpanded || undefined },
    h(
      "summary",
      { className: styles["historySummary"] },
      h(
        "span",
        null,
        h("strong", null, "포인트 내역"),
        h("small", null, `${transactions.length}건`),
      ),
      h("span", { "aria-hidden": true, className: styles["disclosure"] }, "보기"),
    ),
    h("div", { className: styles["historyContent"] }, content),
  )
}
