import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PortfolioHistory } from "../../components/demo-market/portfolio-history"
import type { ArchivedMarketPosition, MarketPosition, MarketRoundHistory } from "./index"

const pending = {
  cardId: "card-1",
  cardLabel: "<script>alert('x')</script>",
  choice: "yes",
  crowdPercentage: 64,
  fixtureOutcome: "yes",
  grossPayout: 157,
  id: "position-1",
  kind: "market",
  placedAt: "2026-08-21T09:00:00.000Z",
  roundId: "round-1",
  stake: 100,
} as const satisfies MarketPosition

const archived = {
  actualOutcome: "yes",
  cardId: pending.cardId,
  cardLabel: pending.cardLabel,
  choice: pending.choice,
  crowdPercentage: pending.crowdPercentage,
  fixtureOutcome: pending.fixtureOutcome,
  grossPayout: pending.grossPayout,
  id: pending.id,
  payout: 157,
  placedAt: pending.placedAt,
  result: "won",
  roundId: pending.roundId,
  settledAt: "2026-08-21T09:01:00.000Z",
  stake: pending.stake,
} satisfies ArchivedMarketPosition

describe("PortfolioHistory", () => {
  it("renders a collapsed native disclosure by default", () => {
    // Given: selector-shaped pending and settled market data
    const rounds: readonly MarketRoundHistory[] = [
      { positions: [archived], roundId: "round-1", totalPayout: 157, totalStake: 100 },
    ]

    // When: the isolated component is rendered through React's server runtime
    const html = renderToStaticMarkup(
      createElement(PortfolioHistory, { pendingPositions: [pending], rounds }),
    )

    // Then: the keyboard-native summary controls content hidden by default
    expect(html).toMatch(/^<details(?![^>]*\bopen\b)[^>]*>/)
    expect(html).toContain("<summary")
    expect(html).toContain('data-market-history-content="true"')
    expect(html).toContain("&lt;script&gt;alert(&#x27;x&#x27;)&lt;/script&gt;")
    expect(html).not.toContain("<script>alert")
    expect(html).not.toContain("포트폴리오와 기록이에요")
    expect(html).not.toContain("진행 중인 포지션이에요")
    expect(html).not.toContain("지난 라운드 기록이에요")
  })

  it("renders the disclosure content revealed when explicitly requested", () => {
    // Given: an explicitly expanded portfolio disclosure
    const rounds: readonly MarketRoundHistory[] = [
      { positions: [archived], roundId: "round-1", totalPayout: 157, totalStake: 100 },
    ]

    // When: the isolated component is rendered in its expanded state
    const html = renderToStaticMarkup(
      createElement(PortfolioHistory, {
        defaultExpanded: true,
        pendingPositions: [pending],
        rounds,
      }),
    )

    // Then: native open state exposes the typed position and round content
    expect(html).toMatch(/^<details[^>]*\bopen=""/)
    expect(html).toContain('data-position-id="position-1"')
    expect(html).toContain('data-round-id="round-1"')
    expect(html).toContain('aria-label="100P 베팅, 예상 지급 157P"')
    expect(html).not.toContain("정산된 라운드가 아직 없어요")
  })

  it("omits an empty settled section and redundant metric labels", () => {
    // Given: one active prediction and no archived rounds
    // When: the compact history is rendered open
    const html = renderToStaticMarkup(
      createElement(PortfolioHistory, {
        defaultExpanded: true,
        pendingPositions: [pending],
        rounds: [],
      }),
    )

    // Then: only useful prediction data remains in the disclosure
    expect(html).toContain("내 예측")
    expect(html).toContain("가능 · 참여자 64%")
    expect(html).not.toContain("지난 라운드")
    expect(html).not.toContain("베팅</dt>")
    expect(html).not.toContain("예상 지급</dt>")
  })
})
