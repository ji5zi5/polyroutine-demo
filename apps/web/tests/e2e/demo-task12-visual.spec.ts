import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "@playwright/test"
import { DEMO_STATE_STORAGE_KEY } from "../../lib/demo-state/persistence"
import {
  type AxeResult,
  activitySnapshot,
  audit,
  capture,
  evidenceRoot,
  preload,
  visualDir,
} from "./support/task12-visual"

const viewports = [
  { height: 844, label: "375", width: 375 },
  { height: 900, label: "768", width: 768 },
  { height: 900, label: "1280", width: 1280 },
] as const
const requestedViewport = process.env.TASK12_VIEWPORT

test.beforeAll(async () => mkdir(visualDir, { recursive: true }))

test("touched surfaces remain polished at every required viewport", async ({ page }) => {
  test.setTimeout(180_000)
  const axeResults: AxeResult[] = []
  const metrics: Record<string, unknown>[] = []
  await page.route("**/api/demo/goal-analysis", async (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        confidence: "high",
        factors: [
          "완료 기준이 구체적이라 실행 여부를 분명하게 확인할 수 있어요",
          "한 번에 끝내기보다 저녁 식사 뒤에 바로 시작하는 편이 성공 가능성을 높여요",
        ],
        probability: 73,
        source: "gemini",
      },
      status: 200,
    }),
  )
  await preload(page)

  for (const viewport of viewports.filter(
    (candidate) => requestedViewport === undefined || candidate.label === requestedViewport,
  )) {
    await page.setViewportSize(viewport)
    await page.goto("/demo")
    await expect(page.getByRole("heading", { name: "가능할지 골라요" })).toBeVisible()
    await capture(page, viewport.label, "prediction")
    axeResults.push(await audit(page, viewport.label, "prediction"))

    const card = page.locator(".predictionCard")
    const goalId = await card.getAttribute("data-goal-id")
    if (goalId === null) throw new TypeError("prediction card id is missing")
    const rest = await card.boundingBox()
    if (rest === null) throw new TypeError("prediction card geometry is missing")
    const barWidth = await page
      .locator(".marketBar")
      .evaluate((node) => node.getBoundingClientRect().width)
    await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2)
    await page.mouse.down()
    await page.mouse.move(rest.x + rest.width / 2 - 32, rest.y + rest.height / 2, { steps: 4 })
    const midpoint = await card.boundingBox()
    if (midpoint === null) throw new TypeError("prediction midpoint geometry is missing")
    const chrome = await page.evaluate(() => ({
      navBottom: document.querySelector(".demoNav")?.getBoundingClientRect().bottom ?? -1,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      paddingInline: getComputedStyle(document.querySelector(".demoViewport") as HTMLElement)
        .paddingInline,
      scrollY,
      topBarY: document.querySelector(".demoTopBar")?.getBoundingClientRect().y ?? -1,
    }))
    metrics.push({
      barWidth,
      cardCenterDeltaY: midpoint.y + midpoint.height / 2 - (rest.y + rest.height / 2),
      chrome,
      phone: await page.locator(".demoViewport").boundingBox(),
      viewport: viewport.label,
    })
    expect(Math.abs(midpoint.y + midpoint.height / 2 - (rest.y + rest.height / 2))).toBeLessThan(4)
    expect(chrome).toMatchObject({
      overflow: 0,
      paddingInline: "24px",
      scrollY: 0,
      topBarY: viewport.width < 768 ? 0 : 24,
    })
    await expect(page.locator(".demoTopBar")).toBeInViewport()
    await expect(page.locator(".demoNav")).toBeInViewport()
    const phoneShell = page.locator(".demoViewport")
    await page.evaluate(async () => {
      const screen = document.querySelector<HTMLElement>(".demoScrollableScreen")
      screen?.scrollTo({ left: 0, top: 0 })
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    const [shellBox, topBarBox, navBox] = await Promise.all([
      phoneShell.boundingBox(),
      page.locator(".demoTopBar").boundingBox(),
      page.locator(".demoNav").boundingBox(),
    ])
    if (shellBox === null || topBarBox === null || navBox === null) {
      throw new TypeError("phone chrome geometry is missing")
    }
    expect(topBarBox.y).toBeGreaterThanOrEqual(shellBox.y)
    expect(navBox.y + navBox.height).toBeLessThanOrEqual(shellBox.y + shellBox.height)
    await phoneShell.screenshot({
      path: path.join(visualDir, `swipe-midpoint-${viewport.label}.png`),
    })
    await page.mouse.up()
    await expect(card).toHaveAttribute("data-goal-id", goalId)
    await expect(card).toHaveAttribute("data-swipe", "idle")
    await page.getByRole("button", { name: "건너뛰기" }).click()
    await expect(card).not.toHaveAttribute("data-goal-id", goalId)
    await card.evaluate(async (node) => {
      await Promise.all(
        node.ownerDocument
          .getAnimations()
          .map((animation) => animation.finished.catch(() => undefined)),
      )
    })
    const nextBarWidth = await page
      .locator(".marketBar")
      .evaluate((node) => node.getBoundingClientRect().width)
    expect(Math.abs(nextBarWidth - barWidth)).toBeLessThan(0.5)

    await page.getByRole("button", { name: "내 목표", exact: true }).click()
    await page
      .getByLabel("오늘의 목표")
      .fill("저녁 식사 뒤에 자격증 핵심 개념을 세 쪽으로 정리하기")
    await page.getByRole("button", { name: "성공 확률 분석하기" }).click()
    await expect(page.getByText("73%", { exact: true })).toBeVisible()
    const factorsDisclosure = page.getByText("분석 근거 2개 보기", { exact: true })
    await factorsDisclosure.focus()
    await factorsDisclosure.press("Enter")
    await capture(page, viewport.label, "analysis-result")
    axeResults.push(await audit(page, viewport.label, "analysis-result"))
    await page.getByRole("button", { name: "이 목표 상장하기" }).click()
    await page.getByRole("button", { name: "사진 인증하기" }).click()
    await capture(page, viewport.label, "verification")
    axeResults.push(await audit(page, viewport.label, "verification"))

    await page.evaluate(
      ({ key, snapshot }) => localStorage.setItem(key, JSON.stringify(snapshot)),
      {
        key: DEMO_STATE_STORAGE_KEY,
        snapshot: activitySnapshot(),
      },
    )
    await page.reload()
    await page.getByRole("button", { name: "MY", exact: true }).click()
    await page.getByText("포인트 내역", { exact: true }).click()
    await capture(page, viewport.label, "transaction-history")
    axeResults.push(await audit(page, viewport.label, "transaction-history"))
    await page.getByText("포인트 내역", { exact: true }).click()
    await page.getByText("포트폴리오와 기록이에요", { exact: true }).click()
    await capture(page, viewport.label, "portfolio-history")
    axeResults.push(await audit(page, viewport.label, "portfolio-history"))
    const resetTrigger = page.getByRole("button", { name: "데모 초기화" })
    await resetTrigger.focus()
    await resetTrigger.press("Enter")
    const reset = page.getByRole("dialog", { name: "데모를 초기화할까요?" })
    await expect(reset).toBeVisible()
    await capture(page, viewport.label, "reset-dialog")
    axeResults.push(await audit(page, viewport.label, "reset-dialog"))
    await page.keyboard.press("Tab")
    await expect(reset.locator(":focus")).toHaveCount(1)
    await page.keyboard.press("Escape")
    await expect(resetTrigger).toBeFocused()

    await page.getByRole("button", { name: "포인트", exact: true }).click()
    await page.getByText("사용 가능 1개", { exact: true }).scrollIntoViewIfNeeded()
    const couponTrigger = page.locator("[data-coupon-id] button").filter({ hasText: "사용 가능" })
    await couponTrigger.focus()
    await couponTrigger.press("Enter")
    const useCoupon = page.getByRole("button", { name: "사용하기", exact: true })
    await useCoupon.focus()
    await useCoupon.press("Enter")
    await expect(page.getByText("이 쿠폰을 사용 처리할까요?", { exact: true })).toBeVisible()
    await capture(page, viewport.label, "coupon-use-dialog")
    axeResults.push(await audit(page, viewport.label, "coupon-use-dialog"))
    await page.keyboard.press("Escape")
    await expect(couponTrigger).toBeFocused()
    await page.evaluate((key) => {
      localStorage.removeItem(key)
      sessionStorage.removeItem(`task12:${key}`)
    }, DEMO_STATE_STORAGE_KEY)
  }

  await writeFile(
    path.join(evidenceRoot, "task-12-axe.json"),
    `${JSON.stringify(axeResults, null, 2)}\n`,
  )
  await writeFile(
    path.join(evidenceRoot, "task-12-layout-metrics.json"),
    `${JSON.stringify(metrics, null, 2)}\n`,
  )
  expect(axeResults.flatMap((result) => result.seriousOrCritical)).toEqual([])
  expect(axeResults.flatMap((result) => result.undersizedTargets)).toEqual([])
})

test("keyboard and reduced motion preserve visible feedback", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 375 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await preload(page, activitySnapshot())
  await page.goto("/demo")
  const card = page.locator(".predictionCard")
  await card.focus()
  await card.press("ArrowLeft")
  await expect(page.getByText("-100P · 가능 베팅", { exact: true })).toBeVisible()
  const pointsTab = page.getByRole("button", { name: "포인트", exact: true })
  await pointsTab.focus()
  await pointsTab.press("Enter")
  const settlement = page.getByRole("button", { name: "예측 결과 정산하기" })
  await settlement.focus()
  await settlement.press("Enter")
  await expect(page.getByRole("button", { name: /\+\d+P 적중/ })).toBeVisible()
  await capture(page, "375", "reduced-motion-settlement")
})
