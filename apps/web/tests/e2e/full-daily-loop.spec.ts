import { type APIRequestContext, expect, test } from "@playwright/test"
import { z } from "zod"
import { prepareGuidedPhoto, readEvidenceContract } from "./support/evidence"
import {
  API_ORIGIN,
  resetScenario,
  setServerTime,
  signupThroughApi,
  signupThroughUi,
  WEB_ORIGIN,
} from "./support/flows"

const goalSchema = z.object({ id: z.uuid() })
const todaySchema = z.object({ goal: goalSchema })
const reviewSchema = z.object({
  leaseToken: z.uuid(),
  reviewId: z.uuid(),
})

async function readGoalId(request: APIRequestContext, subjectKey: string): Promise<string> {
  const response = await request.get(`${WEB_ORIGIN}/v1/goals/today`, {
    headers: { "x-subject-key": subjectKey },
  })
  expect(response.status()).toBe(200)
  return todaySchema.parse(await response.json()).goal.id
}

test("full-daily-loop shows one terminal award, correction, and next-local-day return", async ({
  page,
  request,
}) => {
  // Given: one owner goal, one effective NO vote, and one server-confirmed pending receipt.
  await resetScenario(request)
  await page.goto("/")
  const owner = await signupThroughUi(page, "task13-owner@example.test")
  await page.getByRole("button", { name: "오늘 목표 만들기" }).click()
  await expect(page.getByRole("heading", { name: "서버가 확정한 오늘 목표" })).toBeVisible()
  const goalId = await readGoalId(request, owner.subjectKey)
  const predictor = await signupThroughApi(request, "task13-predictor@example.test")
  const prediction = await request.post(`${WEB_ORIGIN}/v1/predictions/${goalId}`, {
    data: { choice: "no" },
    headers: {
      "idempotency-key": "task13-no-vote",
      "x-subject-key": predictor.subjectKey,
    },
  })
  expect(prediction.status()).toBe(201)
  const opened = await request.post(`${API_ORIGIN}/__e2e/goals/${goalId}/evidence-open`)
  expect(opened.status()).toBe(200)
  await page.reload()
  await prepareGuidedPhoto(page)
  await page.getByRole("button", { name: "사진을 서버에 제출" }).click()
  await expect(page.getByRole("heading", { name: "사진 영수증이 접수되었습니다" })).toBeVisible()
  const receipt = await readEvidenceContract(request, goalId)
  const evidenceId = receipt.evidence[0]?.receipt_id
  if (evidenceId === undefined) throw new TypeError("pending evidence receipt is missing")

  // When: the real operator API accepts the receipt and atomically settles the goal.
  const claim = await request.post(`${API_ORIGIN}/v1/operator/evidence-reviews/claim`, {
    headers: { "x-operator-subject-key": "task13-operator" },
  })
  expect(claim.status()).toBe(200)
  const review = reviewSchema.parse(await claim.json())
  const decision = await request.post(
    `${API_ORIGIN}/v1/operator/evidence-reviews/${review.reviewId}/decision`,
    {
      data: { verdict: "accepted" },
      headers: {
        "idempotency-key": "task13-accepted",
        "x-operator-subject-key": "task13-operator",
        "x-review-lease-token": review.leaseToken,
      },
    },
  )
  expect(decision.status()).toBe(200)
  await page.getByRole("button", { name: "검토 상태 새로고침" }).click()

  // Then: terminal state and each persisted award appear exactly once, without money claims.
  await expect(page.getByRole("heading", { name: "오늘 목표가 완료되었어요" })).toHaveCount(1)
  await expect(page.getByText("NO 1표 · YES 0표 · 총 1표")).toBeVisible()
  await expect(page.getByText("완료 평판 +10점")).toHaveCount(1)
  await expect(page.getByText("NO 다수에서 완료한 평판 +5점")).toHaveCount(1)
  await expect(page.getByText("비환전·비양도 파생 평판")).toBeVisible()

  // When: an append-only operator correction changes the effective terminal outcome.
  const correction = await request.post(`${API_ORIGIN}/v1/operator/goals/${goalId}/corrections`, {
    data: { correctedState: "failed", reason: "accepted decision corrected after review" },
    headers: {
      "idempotency-key": "task13-correction",
      "x-operator-subject-key": "task13-operator",
    },
  })
  expect(correction.status()).toBe(200)
  await page.getByRole("button", { name: "오늘 상태 새로고침" }).click()

  // Then: the correction is explicit and the inverse award is displayed once.
  await expect(page.getByText("운영자 교정으로 미완료 상태가 적용되었어요.")).toBeVisible()
  await expect(page.getByText("운영자 교정 -15점")).toHaveCount(1)

  // When: the server enters the next local day and the owner creates a new goal.
  await setServerTime(request, "2099-08-21T00:00:00.000Z")
  await page.getByRole("button", { name: "오늘 상태 새로고침" }).click()
  await expect(page.getByRole("heading", { name: "이전 결과와 평판 기록" })).toBeVisible()
  await expect(page.getByRole("button", { name: "오늘 목표 만들기" })).toBeEnabled()
  await page.getByRole("button", { name: "오늘 목표 만들기" }).click()

  // Then: the prior corrected result remains while the new local-day goal opens.
  await expect(page.getByRole("heading", { name: "서버가 확정한 오늘 목표" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "이전 결과와 평판 기록" })).toBeVisible()
})
