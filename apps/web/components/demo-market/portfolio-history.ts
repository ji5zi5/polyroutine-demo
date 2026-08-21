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

function positionNumbers(stake: number, payout: number, payoutLabel: string) {
  return h(
    "dl",
    { className: styleClass("numbers") },
    h("div", null, h("dt", null, "베팅"), h("dd", null, `${points.format(stake)}P`)),
    h("div", null, h("dt", null, payoutLabel), h("dd", null, `${points.format(payout)}P`)),
  )
}

export function PortfolioHistory({
  defaultExpanded = false,
  pendingPositions,
  rounds,
}: PortfolioHistoryProps) {
  return h(
    "details",
    { className: styleClass("surface"), open: defaultExpanded || undefined },
    h(
      "summary",
      { className: styleClass("header") },
      h(
        "span",
        { className: styleClass("title") },
        h("span", { className: styleClass("eyebrow") }, "내 예측"),
        h("strong", null, "포트폴리오와 기록이에요"),
      ),
      h("span", { className: styleClass("count") }, `${pendingPositions.length}건 진행 중`),
    ),
    h(
      "div",
      { className: styleClass("content"), "data-market-history-content": true },
      h(
        "section",
        { "aria-labelledby": "pending-positions-title", className: styleClass("section") },
        h("h3", { id: "pending-positions-title" }, "진행 중인 포지션이에요"),
        pendingPositions.length === 0
          ? h("p", { className: styleClass("empty") }, "아직 진행 중인 포지션이 없어요.")
          : h(
              "ul",
              { className: styleClass("list") },
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
                      `${choiceLabel(position.choice)} · 당시 참여자 ${position.crowdPercentage}%`,
                    ),
                  ),
                  positionNumbers(position.stake, position.grossPayout, "예상 지급"),
                ),
              ),
            ),
      ),
      h(
        "section",
        { "aria-labelledby": "settled-rounds-title", className: styleClass("section") },
        h("h3", { id: "settled-rounds-title" }, "지난 라운드 기록이에요"),
        rounds.length === 0
          ? h("p", { className: styleClass("empty") }, "정산된 라운드가 아직 없어요.")
          : h(
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
                    h("strong", null, round.roundId),
                    h(
                      "span",
                      null,
                      `총 베팅 ${points.format(round.totalStake)}P · 총 지급 ${points.format(round.totalPayout)}P`,
                    ),
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
                            `${choiceLabel(position.choice)} · 당시 참여자 ${position.crowdPercentage}% · ${position.result === "won" ? "적중했어요" : "빗나갔어요"}`,
                          ),
                        ),
                        positionNumbers(position.stake, position.payout, "지급"),
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
