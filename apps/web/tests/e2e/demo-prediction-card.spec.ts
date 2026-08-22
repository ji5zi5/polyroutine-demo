import { expect, type Page, test } from "@playwright/test"
import { predictionCards } from "../../components/demo-prediction-cards"

async function loginDemo(page: Page): Promise<void> {
  await page.getByLabel("이메일").fill("demo@polyroutine.app")
  await page.getByLabel("비밀번호").fill("routine123")
  await page.getByRole("button", { name: "로그인", exact: true }).click()
}

test("every prediction goal uses a consistent nominalized ending", () => {
  const goalLabels = predictionCards.flatMap((card) => card.tasks ?? [card.recipe.instructions])

  expect(goalLabels).toHaveLength(199)
  for (const label of goalLabels) expect(label).toMatch(/기$/)
})

test("goal bundles keep a full-width market bar without redundant decoration", async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")
  await loginDemo(page)
  await page.getByRole("button", { name: "건너뛰기" }).click()
  await page.getByRole("button", { name: "건너뛰기" }).click()

  const card = page.locator(".predictionCard")
  await expect(card.getByRole("list", { name: "묶음 목표" })).toBeVisible()
  await expect(card.getByRole("heading", { name: "오늘 목표 2개" })).toHaveCount(0)

  const widths = await card.evaluate((element) => {
    const cardBox = element.getBoundingClientRect()
    const marketBar = element.querySelector<HTMLElement>(".marketBar")
    const firstGoal = element.querySelector<HTMLElement>(".predictionGoalBundle li")
    if (marketBar === null || firstGoal === null) throw new TypeError("card content is missing")
    return {
      card: cardBox.width,
      marker: getComputedStyle(firstGoal, "::before").content,
      market: marketBar.getBoundingClientRect().width,
    }
  })
  expect(widths.marker).toBe("none")
  expect(widths.market).toBeGreaterThan(widths.card - 50)
})

test("committing a prediction uses card motion without duplicate text feedback", async ({
  page,
}) => {
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")
  await loginDemo(page)

  const card = page.locator(".predictionCard")
  await card.focus()
  await card.press("ArrowLeft")

  await expect(page.locator(".swipeGestureGuide")).toHaveCount(0)
  await expect(page.getByText("-100P · 가능 베팅", { exact: true })).toHaveCount(0)
  await expect(page.getByText("51,100P", { exact: true })).toBeVisible()
  await expect(card).toHaveAttribute("data-goal-id", "demo-2")
})
