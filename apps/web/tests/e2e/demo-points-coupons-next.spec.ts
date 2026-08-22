import { writeFileSync } from "node:fs"
import path from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { createInitialDemoState } from "../../lib/demo-state/domain"
import {
  createDemoPersistenceSnapshot,
  DEMO_STATE_STORAGE_KEY,
  demoPersistenceSchema,
} from "../../lib/demo-state/persistence"

const evidenceDir = path.resolve(
  import.meta.dirname,
  "../../../../.omo/evidence/polyroutine-demo-next-iteration",
)

function seededSnapshot(initialPoints: number) {
  const now = new Date("2026-08-21T03:00:00.000Z")
  const initial = createInitialDemoState({ createId: () => "unused", now: () => now })
  return createDemoPersistenceSnapshot(true, "points@polyroutine.app", {
    ...initial,
    balance: initialPoints,
    initialBalance: initialPoints,
  })
}

async function preload(page: Page, initialPoints: number): Promise<void> {
  const snapshot = seededSnapshot(initialPoints)
  await page.addInitScript(
    ({ key, value }) => {
      const marker = `seeded:${key}`
      if (sessionStorage.getItem(marker) !== null) return
      localStorage.setItem(key, JSON.stringify(value))
      sessionStorage.setItem(marker, "true")
    },
    { key: DEMO_STATE_STORAGE_KEY, value: snapshot },
  )
}

async function stored(page: Page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), DEMO_STATE_STORAGE_KEY)
  if (raw === null) throw new TypeError("demo snapshot is missing")
  return demoPersistenceSchema.parse(JSON.parse(raw))
}

function demoUrl(now: string, idPrefix: string): string {
  return `/demo?demoNow=${encodeURIComponent(now)}&demoIdPrefix=${idPrefix}`
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 })
})

test("attendance is local-day idempotent and every displayed point reconciles", async ({
  page,
}) => {
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  await preload(page, 51_200)
  await page.goto(demoUrl("2026-08-21T12:00:00+09:00", "attendance-day-1"))
  await page.getByRole("button", { name: "포인트", exact: true }).click()

  const attendanceTrigger = page.getByRole("button", { name: "출석체크" })
  await attendanceTrigger.click()
  const dialog = page.getByRole("dialog", { name: "8월 출석체크" })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText("데모 예시", { exact: false })).toHaveCount(0)
  const claim = dialog.getByRole("button", { name: "오늘 출석하기 · +200P" })
  await claim.evaluate((button) => {
    button.click()
    button.click()
  })
  await expect(dialog).toBeHidden()
  let snapshot = await stored(page)
  expect(snapshot.state.attendance).toHaveLength(1)
  expect(snapshot.state.ledger.filter((event) => event.sourceType === "attendance")).toHaveLength(1)

  await page.reload()
  await page.getByRole("button", { name: "포인트", exact: true }).click()
  await page.getByRole("button", { name: "오늘 출석 완료" }).click()
  await expect(page.getByRole("button", { name: "오늘 출석 완료 · +200P" })).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "오늘 출석 완료" })).toBeFocused()

  await page.goto(demoUrl("2026-08-22T12:00:00+09:00", "attendance-day-2"))
  await page.getByRole("button", { name: "포인트", exact: true }).click()
  await page.getByRole("button", { name: "출석체크" }).click()
  await page.getByRole("button", { name: "오늘 출석하기 · +200P" }).click()
  snapshot = await stored(page)
  expect(snapshot.state.attendance.map((entry) => entry.localDate)).toEqual([
    "2026-08-21",
    "2026-08-22",
  ])
  const independentlyReconciled = snapshot.state.ledger.reduce(
    (balance, event) =>
      event.direction === "credit" ? balance + event.amount : balance - event.amount,
    snapshot.state.initialBalance,
  )
  expect(independentlyReconciled).toBe(snapshot.state.balance)
  expect(JSON.stringify(snapshot)).not.toMatch(/password|apiKey|blob:/i)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
  await page.getByText("포인트 내역", { exact: true }).click()
  await expect(
    page.getByText(`결과 잔액 ${snapshot.state.balance.toLocaleString("ko-KR")}P`),
  ).toBeVisible()
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDir, "task-09-ledger-375.png"),
  })
  await page.getByRole("button", { name: "오늘 출석 완료" }).click()
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDir, "task-09-attendance-375.png"),
  })
  await page.keyboard.press("Escape")
  expect(runtimeErrors).toEqual([])
  writeFileSync(
    path.join(evidenceDir, "task-09-ledger.json"),
    `${JSON.stringify({ independentlyReconciled, snapshot, runtimeErrors }, null, 2)}\n`,
  )
})

test("repeat purchases create usable coupon instances and shortage is exact", async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  await preload(page, 120_000)
  await page.goto(demoUrl("2026-08-21T12:00:00+09:00", "coupon-purchase"))
  await page.getByRole("button", { name: "포인트", exact: true }).click()
  const purchase = page.getByRole("button", {
    name: "GS25 모바일 상품권 1천원권 50,000P로 구매",
  })
  for (let index = 0; index < 2; index += 1) {
    await purchase.click()
    await page.getByRole("button", { name: "구매하기", exact: true }).evaluate((button) => {
      button.click()
      button.click()
    })
    await expect(purchase).toBeFocused()
  }
  let snapshot = await stored(page)
  expect(snapshot.state.balance).toBe(20_000)
  expect(snapshot.state.coupons).toHaveLength(2)
  expect(new Set(snapshot.state.coupons.map((coupon) => coupon.id)).size).toBe(2)
  expect(new Set(snapshot.state.coupons.map((coupon) => coupon.purchasedAt)).size).toBe(2)
  expect(
    snapshot.state.ledger.filter((event) => event.sourceType === "coupon_purchase"),
  ).toHaveLength(2)

  await page.getByRole("button", { name: "MY", exact: true }).click()
  await page.getByText("쿠폰 내역", { exact: true }).click()
  await expect(page.getByRole("heading", { name: "사용 가능 2개" })).toBeVisible()
  const availableCoupons = page.locator("[data-coupon-id] button").filter({ hasText: "사용 가능" })
  await availableCoupons.first().click()
  await expect(page.getByRole("dialog", { name: "GS25 모바일 상품권 1천원권" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(availableCoupons.first()).toBeFocused()
  await availableCoupons.first().click()
  await page.getByRole("button", { name: "사용하기", exact: true }).click()
  await expect(page.getByText("이 쿠폰을 사용 처리할까요?", { exact: true })).toBeVisible()
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDir, "task-10-coupon-detail-375.png"),
  })
  await page.getByRole("button", { name: "사용 확정하기", exact: true }).evaluate((button) => {
    button.click()
    button.click()
  })
  const balanceAfterUse = (await stored(page)).state.balance
  expect(balanceAfterUse).toBe(20_000)
  await expect(page.getByRole("heading", { name: "사용한 쿠폰 1개" })).toBeVisible()

  await page.reload()
  await page.getByRole("button", { name: "MY", exact: true }).click()
  await page.getByText("쿠폰 내역", { exact: true }).click()
  await expect(page.getByRole("heading", { name: "사용 가능 1개" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "사용한 쿠폰 1개" })).toBeVisible()
  await page.getByRole("button", { name: "포인트", exact: true }).click()
  const beforeInsufficient = await stored(page)
  const insufficientTrigger = page.getByRole("button", {
    name: "배스킨라빈스 교환권 30,000원 1,500,000P로 구매",
  })
  await insufficientTrigger.click()
  await expect(
    page.getByText("가격 1,500,000P · 보유 20,000P · 부족 1,480,000P", { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "포인트가 부족해요" })).toBeDisabled()
  expect((await stored(page)).state).toEqual(beforeInsufficient.state)
  await page.keyboard.press("Escape")
  await expect(insufficientTrigger).toBeFocused()

  const assets = await page.getByRole("img").evaluateAll((images) =>
    images.map((image) => ({
      alt: image.getAttribute("alt"),
      naturalHeight: (image as HTMLImageElement).naturalHeight,
      naturalWidth: (image as HTMLImageElement).naturalWidth,
    })),
  )
  expect(new Set(assets.map((asset) => asset.alt)).size).toBe(8)
  expect(
    assets.every(
      (asset) => asset.alt !== null && asset.naturalHeight > 0 && asset.naturalWidth > 0,
    ),
  ).toBe(true)
  expect(JSON.stringify(snapshot)).not.toMatch(/password|apiKey|blob:/i)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
  await page.getByRole("heading", { name: "포인트 상점" }).scrollIntoViewIfNeeded()
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDir, "task-10-shop-375.png"),
  })
  snapshot = await stored(page)
  expect(runtimeErrors).toEqual([])
  writeFileSync(
    path.join(evidenceDir, "task-10-coupons.json"),
    `${JSON.stringify({ assets, snapshot, runtimeErrors }, null, 2)}\n`,
  )
})
