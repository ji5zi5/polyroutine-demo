import path from "node:path"
import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"
import { createInitialDemoState, reduceDemoState } from "../../../lib/demo-state"
import {
  createDemoPersistenceSnapshot,
  DEMO_STATE_STORAGE_KEY,
} from "../../../lib/demo-state/persistence"

export const evidenceRoot = path.resolve(
  import.meta.dirname,
  "../../../../../.omo/evidence/polyroutine-demo-next-iteration",
)
export const visualDir = path.join(evidenceRoot, "task-12-visual")

export type AxeResult = Readonly<{
  seriousOrCritical: readonly Readonly<{
    id: string
    targets: readonly (readonly string[])[]
  }>[]
  state: string
  undersizedTargets: readonly string[]
  viewport: string
}>

export function activitySnapshot() {
  let index = 0
  const dependencies = {
    createId: () => `task12-${++index}`,
    now: () => new Date(`2026-08-21T09:00:${String(index).padStart(2, "0")}.000Z`),
  }
  let state = createInitialDemoState(dependencies)
  state = reduceDemoState(
    state,
    {
      titles: ["오늘 저녁 식사 뒤에 자격증 핵심 개념을 세 쪽으로 정리하기"],
      type: "replace_goals",
    },
    dependencies,
  )
  state = reduceDemoState(
    state,
    {
      cardId: "task12-settled",
      cardLabel: "한국어 기술 서적 한 장 읽고 핵심 문장 세 개 메모하기",
      choice: "yes",
      crowdPercentage: 40,
      fixtureOutcome: "yes",
      roundId: state.round.id,
      stake: 100,
      type: "place_market_position",
    },
    dependencies,
  )
  state = reduceDemoState(
    state,
    { roundId: state.round.id, type: "settle_market_round" },
    dependencies,
  )
  state = reduceDemoState(
    state,
    {
      cardId: "task12-pending",
      cardLabel: "잠들기 전에 휴대폰을 내려놓고 종이책 열 쪽 읽기",
      choice: "no",
      crowdPercentage: 25,
      fixtureOutcome: "yes",
      roundId: state.round.id,
      stake: 100,
      type: "place_market_position",
    },
    dependencies,
  )
  state = reduceDemoState(
    state,
    { catalogId: "americano", cost: 1_000, label: "아이스 아메리카노", type: "purchase_coupon" },
    dependencies,
  )
  const usedCoupon = state.coupons[0]
  if (usedCoupon === undefined) throw new TypeError("task 12 coupon fixture is missing")
  state = reduceDemoState(state, { couponId: usedCoupon.id, type: "use_coupon" }, dependencies)
  state = reduceDemoState(
    state,
    {
      catalogId: "convenience",
      cost: 1_000,
      label: "GS25 모바일 상품권 1천원권",
      type: "purchase_coupon",
    },
    dependencies,
  )
  return createDemoPersistenceSnapshot(true, "visual@polyroutine.app", state)
}

function emptySnapshot() {
  const now = new Date("2026-08-21T09:00:00.000Z")
  const dependencies = { createId: () => "task12-initial", now: () => now }
  return createDemoPersistenceSnapshot(
    true,
    "visual@polyroutine.app",
    reduceDemoState(
      createInitialDemoState(dependencies),
      { titles: [], type: "replace_goals" },
      dependencies,
    ),
  )
}

export async function preload(page: Page, value = emptySnapshot()) {
  await page.addInitScript(
    ({ key, snapshot }) => {
      const marker = `task12:${key}`
      if (sessionStorage.getItem(marker) !== null) return
      localStorage.setItem(key, JSON.stringify(snapshot))
      sessionStorage.setItem(marker, "seeded")
    },
    { key: DEMO_STATE_STORAGE_KEY, snapshot: value },
  )
}

async function settle(page: Page): Promise<void> {
  await page.mouse.move(1, 1)
  await page.evaluate(async () => {
    window.scrollTo(0, 0)
    for (const screen of document.querySelectorAll<HTMLElement>(".demoScrollableScreen")) {
      screen.scrollTo({ left: 0, top: 0 })
    }
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    )
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  })
}

export async function capture(page: Page, viewport: string, state: string): Promise<void> {
  await settle(page)
  await page.screenshot({
    animations: "disabled",
    path: path.join(visualDir, `${state}-${viewport}.png`),
  })
}

export async function audit(page: Page, viewport: string, state: string): Promise<AxeResult> {
  const scan = await new AxeBuilder({ page }).analyze()
  const undersizedTargets = await page
    .locator("button:visible, input:visible, summary:visible, [role='button']:visible")
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const box = element.getBoundingClientRect()
        if (box.width >= 44 && box.height >= 44) return []
        return [
          `${element.tagName}:${element.textContent?.trim() ?? element.getAttribute("aria-label")}`,
        ]
      }),
    )
  return {
    seriousOrCritical: scan.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target),
      })),
    state,
    undersizedTargets,
    viewport,
  }
}
