import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DemoPointsSurface } from "../../components/demo-points/demo-points-surface.js"
import {
  createInitialDemoState,
  type DemoDependencies,
  reduceDemoState,
} from "../demo-state/index.js"
import { selectAttendanceCalendar } from "./attendance-calendar.js"
import {
  reconcilePoints,
  selectAttendanceEligibility,
  selectPointTransactions,
} from "./points-view-model.js"

function demoState() {
  const ids = ["attendance-event", "coupon-instance", "purchase-event"]
  let index = 0
  const dependencies: DemoDependencies = {
    createId: () => ids[index++] ?? `extra-${index}`,
    now: () => new Date("2026-08-21T09:00:00.000Z"),
  }
  const initial = createInitialDemoState(dependencies)
  const attended = reduceDemoState(
    initial,
    { amount: 200, localDate: "2026-08-21", type: "claim_attendance" },
    dependencies,
  )
  return reduceDemoState(
    attended,
    { catalogId: "coffee", cost: 1_000, label: "아메리카노", type: "purchase_coupon" },
    dependencies,
  )
}

function render(open: boolean, defaultHistoryExpanded = false): string {
  return renderToStaticMarkup(
    createElement(DemoPointsSurface, {
      attendanceDialogOpen: open,
      defaultHistoryExpanded,
      now: new Date(2026, 7, 21, 12),
      onClaimAttendance: () => {},
      onCloseAttendance: () => {},
      onOpenAttendance: () => {},
      state: demoState(),
    }),
  )
}

describe("demo points surface", () => {
  it("renders the reducer balance and newest-first compact transaction disclosure", () => {
    // Given: one attendance credit followed by one purchase debit
    // When: the default compact points surface is rendered
    const html = render(false)

    // Then: balance and independently derived running balances are visible without expanding by default
    expect(html).toContain('data-points-balance="50400"')
    expect(html).toContain("50,400점")
    expect(html.indexOf("상품 구매")).toBeLessThan(html.indexOf("출석 적립"))
    expect(html).toContain("결과 잔액 50,400P")
    expect(html).toContain("결과 잔액 51,400P")
    expect(html).toMatch(/<details(?![^>]* open)/)
  })

  it("renders only actual attendance history without seeded demo dates", () => {
    // Given: an opened attendance dialog with one actual claim
    // When: the calendar is rendered for the injected browser-local month
    const html = render(true, true)

    // Then: the modal is accessible and contains no explanatory demo fixture
    expect(html).toMatch(/<dialog/)
    expect(html).toContain('aria-modal="true"')
    expect(html).not.toContain("데모 예시")
    expect(html).not.toContain("화면 설명용")
    expect(html).not.toContain('data-attendance-status="example"')
    expect(html).toContain('aria-label="8월 21일, 내 출석 기록"')
    expect(html).toContain('aria-current="date"')
    expect(html).toMatch(/<details[^>]* open=""/)
  })

  it.skipIf(process.env["WRITE_TASK_09_EVIDENCE"] !== "true")(
    "renders the isolated points foundation and records independently reconciled evidence",
    async () => {
      // Given: the deterministic attendance/purchase state and its isolated open surface
      const state = demoState()
      const now = new Date(2026, 7, 21, 12)
      const html = render(true, true)
      const transactions = selectPointTransactions(state)
      const reconciliation = reconcilePoints(state)
      const independentlySummed = state.ledger.reduce(
        (balance, event) =>
          event.direction === "credit" ? balance + event.amount : balance - event.amount,
        state.initialBalance,
      )
      const artifact = {
        attendance: {
          calendar: selectAttendanceCalendar(state, now),
          eligibility: selectAttendanceEligibility(state, now),
        },
        independentBalance: independentlySummed,
        reconciliation,
        transactions,
      }
      const evidenceDir = path.resolve(
        import.meta.dirname,
        "../../../../.omo/evidence/task-09-foundation",
      )

      // When: the foundation writes a static manual-inspection surface and machine-readable ledger
      await mkdir(evidenceDir, { recursive: true })
      await writeFile(
        path.join(evidenceDir, "task-09-points-surface.html"),
        `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Task 09 points foundation</title></head><body>${html}</body></html>`,
        "utf8",
      )
      await writeFile(
        path.join(evidenceDir, "task-09-ledger.json"),
        `${JSON.stringify(artifact, null, 2)}\n`,
        "utf8",
      )

      // Then: the independent sum, displayed value, and generated artifacts agree exactly
      expect(independentlySummed).toBe(state.balance)
      expect(reconciliation.isBalanced).toBe(true)
      expect(transactions).toHaveLength(2)
      expect(html).toContain(`data-points-balance="${independentlySummed}"`)
    },
  )
})

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
