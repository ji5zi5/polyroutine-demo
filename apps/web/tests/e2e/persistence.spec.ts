import { expect, test } from "@playwright/test"
import { resetScenario, setServerTime, signupThroughUi } from "./support/flows"
import { captureResponsiveState } from "./support/visual"

test("onboarding-goal-feed opens the next local day and preserves the prior goal", async ({
  page,
  request,
}) => {
  // Given
  await resetScenario(request)
  await page.goto("/")
  await signupThroughUi(page, "task7-next-day@example.test")
  await page.getByLabel("학습 노트 줄 수").fill("17")
  await page.getByRole("button", { name: "오늘 목표 만들기" }).click()
  await expect(page.getByText(/학습 노트 17줄 이상/)).toBeVisible()

  // When
  await setServerTime(request, "2099-08-21T00:00:00.000Z")
  await page.reload()

  // Then
  await expect(page.getByRole("heading", { name: "이전 목표 기록" })).toBeVisible()
  await expect(page.getByText(/학습 노트 17줄 이상/)).toBeVisible()
  await page.getByLabel("학습 노트 줄 수").fill("6")
  await page.getByRole("button", { name: "오늘 목표 만들기" }).click()
  await expect(page.getByText(/학습 노트 6줄 이상/)).toBeVisible()
  await expect(page.getByText(/학습 노트 17줄 이상/)).toBeVisible()
})

test("onboarding-goal-feed isolates cached history between accounts", async ({ page, request }) => {
  // Given
  await resetScenario(request)
  await page.goto("/")
  await signupThroughUi(page, "task7-cache-owner@example.test")
  await page.getByLabel("학습 노트 줄 수").fill("19")
  await page.getByRole("button", { name: "오늘 목표 만들기" }).click()
  await expect(page.getByText(/학습 노트 19줄 이상/)).toBeVisible()
  await page.getByRole("button", { name: "로그아웃" }).click()

  // When
  await signupThroughUi(page, "task7-cache-other@example.test")

  // Then
  await expect(page.getByRole("heading", { name: "이전 목표 기록" })).toHaveCount(0)
  await expect(page.getByText(/학습 노트 19줄 이상/)).toHaveCount(0)
  await expect(page.getByRole("button", { name: "오늘 목표 만들기" })).toBeEnabled()
})

test("onboarding-goal-feed serves cached history offline and blocks mutations", async ({
  context,
  page,
  request,
}) => {
  // Given
  await resetScenario(request)
  await page.goto("/")
  await signupThroughUi(page, "task7-offline-shell@example.test")
  await page.getByLabel("학습 노트 줄 수").fill("13")
  await page.getByRole("button", { name: "오늘 목표 만들기" }).click()
  await expect(page.getByText(/학습 노트 13줄 이상/)).toBeVisible()
  await page.evaluate(async () => navigator.serviceWorker.ready)
  await setServerTime(request, "2099-08-21T00:00:00.000Z")
  await page.reload()
  await expect(page.getByRole("heading", { name: "이전 목표 기록" })).toBeVisible()

  // When
  await context.setOffline(true)
  await page.reload({ waitUntil: "domcontentloaded" })

  // Then
  await expect(page.getByRole("heading", { level: 1, name: "오늘의 루틴" })).toBeVisible()
  await expect(page.getByRole("status").filter({ hasText: "확인된 기록" })).toContainText(
    "오프라인",
  )
  await expect(page.getByText(/학습 노트 13줄 이상/)).toBeVisible()
  await expect(page.getByRole("button", { name: "연결 후 오늘 목표 만들기" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "연결 후 카드 새로고침" })).toBeDisabled()
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)
  await captureResponsiveState(page, "offline-shell-history")
  await context.setOffline(false)
})
