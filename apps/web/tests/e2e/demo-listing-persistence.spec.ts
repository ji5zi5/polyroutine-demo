import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { DEMO_STATE_STORAGE_KEY, demoPersistenceSchema } from "../../lib/demo-state/persistence"

const evidenceDirectory = path.resolve(
  import.meta.dirname,
  "../../../../.omo/evidence/polyroutine-demo-next-iteration/repair-listing-persistence",
)

async function loginDemo(page: Page): Promise<void> {
  await page.getByLabel("이메일").fill("demo@polyroutine.app")
  await page.getByLabel("비밀번호").fill("routine123")
  await page.getByRole("button", { name: "로그인", exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    const marker = "poly-routine-listing-storage-cleared"
    if (sessionStorage.getItem(marker) !== null) return
    localStorage.removeItem(key)
    sessionStorage.setItem(marker, "true")
  }, DEMO_STATE_STORAGE_KEY)
  await page.setViewportSize({ height: 812, width: 375 })
})

test("listed goals retain exact payout inputs through reload logout and login", async ({
  page,
}) => {
  // Given: deterministic AI responses for two distinct listings
  const probabilities = [73, 41] as const
  let requestIndex = 0
  await page.route("**/api/demo/goal-analysis", async (route) => {
    const probability = probabilities[requestIndex]
    requestIndex += 1
    if (probability === undefined) throw new TypeError("unexpected analysis request")
    await route.fulfill({
      contentType: "application/json",
      json: {
        confidence: "high",
        factors: ["완료 기준이 선명해요"],
        probability,
        source: "gemini",
      },
      status: 200,
    })
  })
  await page.goto("/demo?demoNow=2026-08-23T12%3A00%3A00%2B09%3A00")
  await loginDemo(page)
  await page.getByRole("button", { name: "내 목표", exact: true }).click()

  const createListing = async (goal: string, deadline: string): Promise<void> => {
    await page.getByLabel("오늘의 목표").fill(goal)
    await page.getByRole("button", { name: "목표 추가" }).click()
    await page.getByLabel("인증 마감 날짜와 시간").fill(deadline)
    await page.getByRole("button", { name: "성공 확률 분석하기" }).click()
    await page.getByRole("button", { name: "이 목표 상장하기" }).click()
  }

  // When: both goals are listed and the first deadline is edited
  await createListing("정보처리기사 3장 요약", "2026-08-25T21:30")
  await page.getByLabel("정보처리기사 3장 요약 인증 마감 수정").fill("2026-08-26T06:45")
  await page.getByRole("button", { name: "다른 목표 상장하기" }).click()
  await createListing("아침 30분 달리기", "2026-08-27T07:15")

  const beforeReloadRaw = await page.evaluate(
    (key) => localStorage.getItem(key),
    DEMO_STATE_STORAGE_KEY,
  )
  if (beforeReloadRaw === null) throw new TypeError("persisted listing snapshot is missing")
  const beforeReload = demoPersistenceSchema.parse(JSON.parse(beforeReloadRaw))
  expect(beforeReload.state.listedGoals).toMatchObject([
    { deadline: "2026-08-26T06:45", probability: 73, titles: ["정보처리기사 3장 요약"] },
    { deadline: "2026-08-27T07:15", probability: 41, titles: ["아침 30분 달리기"] },
  ])

  await page.reload()
  await page.getByRole("button", { name: "내 목표", exact: true }).click()
  await expect(page.locator(".listedGoalCard")).toHaveCount(2)
  await expect(page.getByLabel("정보처리기사 3장 요약 인증 마감 수정")).toHaveValue(
    "2026-08-26T06:45",
  )
  await expect(page.getByLabel("아침 30분 달리기 인증 마감 수정")).toHaveValue("2026-08-27T07:15")
  await expect(page.getByText("73%", { exact: true })).toBeVisible()
  await expect(page.getByText("41%", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "MY", exact: true }).click()
  await page.getByRole("button", { name: "로그아웃", exact: true }).click()
  await loginDemo(page)
  await page.getByRole("button", { name: "내 목표", exact: true }).click()
  await expect(page.locator(".listedGoalCard")).toHaveCount(2)
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDirectory, "listings-after-relogin-375.png"),
  })

  // Then: the selected listing still settles from its persisted 41% probability
  await page
    .locator(".listedGoalCard")
    .nth(1)
    .getByRole("button", { name: "사진 인증하기" })
    .click()
  await page.locator('input[type="file"]').setInputFiles({
    buffer: await readFile(
      path.resolve(import.meta.dirname, "../../public/rewards/americano-coupon.png"),
    ),
    mimeType: "image/png",
    name: "listing-proof.png",
  })
  await expect(page.getByText("인증이 완료됐어요.")).toBeVisible()
  await page.getByRole("button", { name: "정산 결과 보기" }).click()
  await expect(page.getByRole("heading", { name: "오늘의 정산" })).toBeVisible()
  await expect(page.getByText("AI 예측 41% · ×2.44", { exact: true })).toBeVisible()
  await expect(page.getByText("+244P", { exact: true })).toBeVisible()
  await page.screenshot({
    path: path.join(evidenceDirectory, "listing-payout-after-reload-375.png"),
  })

  // And: confirmed reset removes all persisted listings
  await page.getByRole("button", { name: "MY", exact: true }).click()
  await page.getByRole("button", { name: "데이터 초기화", exact: true }).click()
  await page.getByRole("button", { name: "초기화하기", exact: true }).click()
  await expect(page.getByRole("button", { name: "로그인", exact: true })).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), DEMO_STATE_STORAGE_KEY)).toBeNull()

  await writeFile(
    path.join(evidenceDirectory, "listing-browser-proof.json"),
    `${JSON.stringify(
      {
        listings: beforeReload.state.listedGoals,
        payout: 244,
        probability: 41,
        preservedAcross: ["reload", "logout", "login"],
        resetStorageValue: null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
})
