import { expect, type Page, test } from "@playwright/test"

async function loginDemo(page: Page): Promise<void> {
  await page.getByLabel("이메일").fill("demo@polyroutine.app")
  await page.getByLabel("비밀번호").fill("routine123")
  await page.getByRole("button", { name: "로그인", exact: true }).click()
}

test("settling a correct prediction confirms the earned payout", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")
  await loginDemo(page)

  const card = page.locator(".predictionCard")
  await card.focus()
  await card.press("ArrowRight")
  await expect(card).toHaveAttribute("data-goal-id", "demo-2")
  await page.getByRole("button", { name: "포인트", exact: true }).click()
  await page.getByRole("button", { name: "예측 결과 정산하기" }).evaluate((button) => {
    button.click()
    button.click()
  })

  const feedback = page.getByText("+278P 적중", { exact: true })
  await expect(feedback).toBeVisible()
  await expect(page.getByText("51,378점", { exact: true })).toBeVisible()
  await expect(page.locator(".pointsCard")).toHaveAttribute("data-settled", "true")

  const colors = await feedback.evaluate((element) => {
    const secondary = document.querySelector(".marketPortfolio > div span")
    return {
      feedback: getComputedStyle(element).color,
      opacity: getComputedStyle(element).opacity,
      secondary: secondary === null ? "missing" : getComputedStyle(secondary).color,
    }
  })
  expect(colors.opacity).toBe("1")
  expect(colors.feedback).not.toBe(colors.secondary)
})
