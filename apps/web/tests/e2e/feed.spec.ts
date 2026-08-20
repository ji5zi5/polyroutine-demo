import { expect, test } from "@playwright/test"
import {
  createEligibleGoals,
  predictionCount,
  resetScenario,
  signupThroughUi,
  TEST_PASSWORD,
  tabTo,
} from "./support/flows"
import {
  assertNoCriticalAxeViolations,
  captureInteractionFrame,
  captureResponsiveState,
  writeActionLog,
} from "./support/visual"

test("onboarding-goal-feed completes adult signup, login, goal, and truthful 0/3/5-card flow", async ({
  page,
  request,
}) => {
  await resetScenario(request)
  await page.setViewportSize({ height: 800, width: 360 })
  await page.goto("/")

  await expect(
    page.getByRole("heading", { level: 1, name: "오늘의 한 가지를 함께 지켜봐요" }),
  ).toBeVisible()
  await expect(page.getByText("신원 또는 연령 확인이 아닌 자기 확인")).toBeVisible()
  await captureResponsiveState(page, "onboarding")
  await page.setViewportSize({ height: 800, width: 360 })
  await assertNoCriticalAxeViolations(page, "onboarding-mobile")

  const viewer = await signupThroughUi(page, "task7-viewer@example.test")
  await expect(page.getByTestId("prediction-progress")).toHaveText("0/최대 5")
  await expect(page.getByText("지금 참여할 익명 목표가 없습니다")).toBeVisible()
  await captureResponsiveState(page, "shortage-zero")

  await page.getByLabel("학습 노트 줄 수").fill("4")
  await page.getByRole("button", { name: "오늘 목표 만들기" }).click()
  await expect(page.getByText("서버가 확정한 오늘 목표")).toBeVisible()
  await expect(page.getByText("서버 기준 예측 마감")).toBeVisible()

  await page.getByRole("button", { name: "로그아웃" }).click()
  await page.getByRole("button", { name: "로그인" }).click()
  await page.getByLabel("이메일").fill("task7-viewer@example.test")
  await page.getByLabel("비밀번호").fill(TEST_PASSWORD)
  await page.getByRole("button", { name: "로그인하기" }).click()
  await expect(page.getByText("서버가 확정한 오늘 목표")).toBeVisible()

  await createEligibleGoals(request, "three-card-owner", 3)
  await page.getByRole("button", { name: "카드 새로고침" }).click()
  await expect(page.getByText("현재 3개만 참여할 수 있어요")).toBeVisible()
  await expect(page.locator("[data-goal-id]")).toHaveCount(1)
  await captureResponsiveState(page, "shortage-three")

  const yesButton = page.getByRole("button", { name: "YES - 해낼 것 같아요" })
  await yesButton.scrollIntoViewIfNeeded()
  await captureInteractionFrame(page, "yes-button-rest")
  await yesButton.hover()
  await captureInteractionFrame(page, "yes-button-hover")
  const yesBox = await yesButton.boundingBox()
  if (yesBox === null) throw new TypeError("YES button did not have a measurable box")
  await page.mouse.move(yesBox.x + yesBox.width / 2, yesBox.y + yesBox.height / 2)
  await page.mouse.down()
  await captureInteractionFrame(page, "yes-button-pressed")
  await page.mouse.up()
  await expect(page.getByRole("status")).toContainText("YES가 서버에 저장되었습니다")
  await expect(page.getByTestId("prediction-progress")).toHaveText("1/최대 5")
  await captureInteractionFrame(page, "yes-button-settled")

  const swipeCard = page.locator("[data-goal-id]")
  await swipeCard.scrollIntoViewIfNeeded()
  const box = await swipeCard.boundingBox()
  if (box === null) throw new TypeError("Prediction card did not have a measurable box")
  await captureInteractionFrame(page, "swipe-rest")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.64, box.y + box.height / 2, { steps: 2 })
  await captureInteractionFrame(page, "swipe-mid")
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2, { steps: 2 })
  await page.mouse.up()
  await expect(page.getByRole("status")).toContainText("YES가 서버에 저장되었습니다")
  await expect(page.getByTestId("prediction-progress")).toHaveText("2/최대 5")
  await captureInteractionFrame(page, "swipe-settled")

  const noButton = page.getByRole("button", { name: "NO - 어려울 것 같아요" })
  await tabTo(page, noButton)
  await captureInteractionFrame(page, "no-button-keyboard-focus")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("status")).toContainText("NO가 서버에 저장되었습니다")
  await expect(page.getByTestId("prediction-progress")).toHaveText("3/최대 5")
  await captureInteractionFrame(page, "no-button-keyboard-settled")

  await createEligibleGoals(request, "five-card-owner", 5)
  await page.getByRole("button", { name: "카드 새로고침" }).click()
  await expect(page.getByText("지금 5개의 카드가 준비되어 있어요")).toBeVisible()
  await expect(page.getByRole("heading", { name: "카드가 부족해요" })).toHaveCount(0)
  await captureResponsiveState(page, "feed-five")
  await page.setViewportSize({ height: 900, width: 1280 })
  await assertNoCriticalAxeViolations(page, "feed-five-desktop")
  expect(await predictionCount(request, viewer.subjectKey)).toBe(3)
  await writeActionLog("happy-onboarding-goal-feed", [
    {
      action: "adult signup and fresh login",
      input: "keyboard",
      outcome: "authenticated account and restored goal",
      sequence: 1,
    },
    {
      action: "create guided 25-minute goal",
      input: "button",
      outcome: "server-confirmed goal and UTC deadlines",
      sequence: 2,
    },
    {
      action: "inspect 0, 3, and 5-card inventory",
      input: "screen-reader",
      outcome: "truthful shortage and maximum-progress copy",
      sequence: 3,
    },
    {
      action: "submit YES",
      input: "button",
      outcome: "server-confirmed immutable prediction",
      sequence: 4,
    },
    {
      action: "submit YES",
      input: "swipe",
      outcome: "same server-confirmed behavior as button",
      sequence: 5,
    },
    {
      action: "submit NO",
      input: "keyboard",
      outcome: "same server-confirmed behavior as pointer",
      sequence: 6,
    },
    {
      action: "verify persisted prediction count",
      input: "server",
      outcome: "exactly three effective predictions",
      sequence: 7,
    },
  ])
})
