import { createElement as h } from "react"
import type { MarketPosition, MarketRoundHistory } from "../../lib/demo-state"
import styles from "./portfolio-history.module.css"

type PortfolioHistoryProps = Readonly<{
  defaultExpanded?: boolean
  pendingPositions: readonly MarketPosition[]
  rounds: readonly MarketRoundHistory[]
}>

const points = new Intl.NumberFormat("ko-KR")

function styleClass(name: string): string {
  return styles[name] ?? ""
}

function choiceLabel(choice: MarketPosition["choice"]): string {
  return choice === "yes" ? "가능" : "불가능"
}

function positionQuote(stake: number, payout: number, payoutLabel: string) {
  return h(
    "span",
    {
      "aria-label": `${points.format(stake)}P 베팅, ${payoutLabel} ${points.format(payout)}P`,
      className: styleClass("quote"),
    },
    `${points.format(stake)}P → ${points.format(payout)}P`,
  )
}

export function PortfolioHistory({
  defaultExpanded = false,
  pendingPositions,
  rounds,
}: PortfolioHistoryProps) {
  if (pendingPositions.length === 0 && rounds.length === 0) return null

  return h(
    "details",
    { className: styleClass("surface"), open: defaultExpanded || undefined },
    h(
      "summary",
      { className: styleClass("header") },
      h("strong", { className: styleClass("title") }, "내 예측"),
      h("span", { className: styleClass("count") }, `진행 ${pendingPositions.length}`),
    ),
    h(
      "div",
      { className: styleClass("content"), "data-market-history-content": true },
      pendingPositions.length === 0
        ? null
        : h(
            "ul",
            { "aria-label": "진행 중인 예측", className: styleClass("list") },
            ...pendingPositions.map((position) =>
              h(
                "li",
                {
                  className: styleClass("row"),
                  "data-position-id": position.id,
                  key: position.id,
                },
                h(
                  "div",
                  { className: styleClass("identity") },
                  h("strong", null, position.cardLabel),
                  h(
                    "span",
                    null,
                    `${choiceLabel(position.choice)} · 참여자 ${position.crowdPercentage}%`,
                  ),
                ),
                positionQuote(position.stake, position.grossPayout, "예상 지급"),
              ),
            ),
          ),
      rounds.length === 0
        ? null
        : h(
            "section",
            { "aria-labelledby": "settled-rounds-title", className: styleClass("section") },
            h("h3", { id: "settled-rounds-title" }, "지난 예측"),
            h(
              "ol",
              { className: styleClass("rounds") },
              ...rounds.map((round) =>
                h(
                  "li",
                  {
                    className: styleClass("round"),
                    "data-round-id": round.roundId,
                    key: round.roundId,
                  },
                  h(
                    "header",
                    { className: styleClass("roundHeader") },
                    h("strong", null, "정산 결과"),
                    positionQuote(round.totalStake, round.totalPayout, "총 지급"),
                  ),
                  h(
                    "ul",
                    { className: styleClass("list") },
                    ...round.positions.map((position) =>
                      h(
                        "li",
                        { className: styleClass("historyRow"), key: position.id },
                        h(
                          "div",
                          { className: styleClass("identity") },
                          h("strong", null, position.cardLabel),
                          h(
                            "span",
                            null,
                            `${choiceLabel(position.choice)} · 참여자 ${position.crowdPercentage}% · ${position.result === "won" ? "적중" : "미적중"}`,
                          ),
                        ),
                        positionQuote(position.stake, position.payout, "지급"),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
    ),
  )
}
