import { expect, test } from "@playwright/test"
import {
  createEligibleGoals,
  predictionCount,
  resetScenario,
  signupThroughUi,
  WEB_ORIGIN,
} from "./support/flows"
import { captureResponsiveState, writeActionLog } from "./support/visual"

test("onboarding-goal-feed replaces a card after an immutable 409 race", async ({
  page,
  request,
}) => {
  await resetScenario(request)
  await page.goto("/")
  const viewer = await signupThroughUi(page, "task7-race-viewer@example.test")
  await createEligibleGoals(request, "race-owner", 2)
  await page.getByRole("button", { name: "카드 새로고침" }).click()

  const card = page.locator("[data-goal-id]")
  const racedGoalId = await card.getAttribute("data-goal-id")
  if (racedGoalId === null) throw new TypeError("Prediction card omitted its goal id")
  const competing = await request.post(`${WEB_ORIGIN}/v1/predictions/${racedGoalId}`, {
    data: { choice: "no" },
    headers: {
      "idempotency-key": "task7-competing-vote",
      "x-subject-key": viewer.subjectKey,
    },
  })
  expect(competing.status()).toBe(201)

  await page.getByRole("button", { name: "YES - 해낼 것 같아요" }).click()
  await expect(page.getByRole("status")).toContainText(
    "이미 다른 요청에서 투표가 확정되어 다음 카드를 불러왔어요",
  )
  await expect(page.locator("[data-goal-id]")).not.toHaveAttribute("data-goal-id", racedGoalId)
  expect(await predictionCount(request, viewer.subjectKey)).toBe(1)
  await captureResponsiveState(page, "race-conflict")
  await writeActionLog("immutable-conflict-recovery", [
    {
      action: "store competing NO prediction",
      input: "server",
      outcome: "one effective prediction",
      sequence: 1,
    },
    {
      action: "attempt conflicting YES",
      input: "button",
      outcome: "typed 409 did not duplicate or edit the vote",
      sequence: 2,
    },
    {
      action: "reload eligible feed",
      input: "server",
      outcome: "conflicted card replaced by the next card",
      sequence: 3,
    },
  ])
})

test("onboarding-goal-feed retries a lost offline response without a duplicate vote", async ({
  context,
  page,
  request,
}) => {
  await resetScenario(request)
  await page.goto("/")
  const viewer = await signupThroughUi(page, "task7-offline-viewer@example.test")
  await createEligibleGoals(request, "offline-owner", 1)
  await page.getByRole("button", { name: "카드 새로고침" }).click()

  let responseDropped = false
  await page.route(/\/v1\/predictions\/[0-9a-f-]+$/, async (route) => {
    if (route.request().method() === "POST" && !responseDropped) {
      responseDropped = true
      const delivered = await route.fetch()
      expect(delivered.status()).toBe(201)
      await context.setOffline(true)
      await route.abort("internetdisconnected")
      return
    }
    await route.continue()
  })

  await page.getByRole("button", { name: "YES - 해낼 것 같아요" }).click()
  await expect(
    page.getByRole("alert").filter({ hasText: "연결이 끊겨 서버 확인을 마치지 못했습니다" }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "같은 요청 다시 확인" })).toBeVisible()
  await captureResponsiveState(page, "offline-pending-retry")

  await context.setOffline(false)
  await page.getByRole("button", { name: "같은 요청 다시 확인" }).click()
  await expect(page.getByRole("status")).toContainText("YES가 서버에 저장되었습니다")
  expect(await predictionCount(request, viewer.subjectKey)).toBe(1)
  await page.unrouteAll({ behavior: "wait" })
  await captureResponsiveState(page, "offline-recovered")
  await writeActionLog("offline-idempotent-recovery", [
    {
      action: "deliver vote and drop browser response",
      input: "server",
      outcome: "client retained the original request key",
      sequence: 1,
    },
    {
      action: "show unconfirmed state",
      input: "screen-reader",
      outcome: "assertive error and explicit retry remained available",
      sequence: 2,
    },
    {
      action: "retry after reconnect",
      input: "button",
      outcome: "original response replayed with one effective vote",
      sequence: 3,
    },
  ])
})
