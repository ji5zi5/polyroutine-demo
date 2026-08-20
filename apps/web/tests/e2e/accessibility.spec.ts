import { expect, test } from "@playwright/test"
import { createEligibleGoals, resetScenario, TEST_PASSWORD, tabTo } from "./support/flows"
import { captureInteractionFrame, writeActionLog } from "./support/visual"

test("onboarding-goal-feed supports a keyboard-only signup, goal, and prediction", async ({
  page,
  request,
}) => {
  await resetScenario(request)
  await page.setViewportSize({ height: 800, width: 360 })
  await page.goto("/")

  await tabTo(page, page.getByLabel("이메일"))
  await page.keyboard.type("task7-keyboard-viewer@example.test")
  await tabTo(page, page.getByLabel("비밀번호"))
  await page.keyboard.type(TEST_PASSWORD)
  await tabTo(page, page.getByLabel("만 18세 이상입니다"))
  await page.keyboard.press("Space")
  await tabTo(page, page.getByLabel("이용약관과 개인정보 처리방침에 동의합니다"))
  await page.keyboard.press("Space")
  await tabTo(page, page.getByRole("button", { name: "성인으로 시작하기" }))
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { level: 1, name: "오늘의 루틴" })).toBeVisible()

  await tabTo(page, page.getByLabel("학습 노트 줄 수"))
  await page.keyboard.press("ControlOrMeta+A")
  await page.keyboard.type("5")
  await tabTo(page, page.getByRole("button", { name: "오늘 목표 만들기" }))
  await page.keyboard.press("Enter")
  await expect(page.getByText("서버가 확정한 오늘 목표")).toBeVisible()

  const owner = await createEligibleGoals(request, "keyboard-owner", 1)
  expect(owner).toHaveLength(1)
  await tabTo(page, page.getByRole("button", { name: "카드 새로고침" }))
  await page.keyboard.press("Enter")
  await tabTo(page, page.getByRole("button", { name: "NO - 어려울 것 같아요" }))
  await captureInteractionFrame(page, "keyboard-flow-prediction-focus")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("status")).toContainText("NO가 서버에 저장되었습니다")
  await writeActionLog("keyboard-only-parity", [
    {
      action: "complete adult signup",
      input: "keyboard",
      outcome: "authenticated dashboard",
      sequence: 1,
    },
    {
      action: "create guided goal",
      input: "keyboard",
      outcome: "server-confirmed goal",
      sequence: 2,
    },
    {
      action: "refresh feed and submit NO",
      input: "keyboard",
      outcome: "server-confirmed prediction with visible focus",
      sequence: 3,
    },
  ])
})
