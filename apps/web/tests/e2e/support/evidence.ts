import { type APIRequestContext, expect, type Page } from "@playwright/test"
import { z } from "zod"
import { API_ORIGIN, resetScenario, signupThroughUi, WEB_ORIGIN } from "./flows"

const goalSchema = z.object({
  evidenceDeadlineAt: z.iso.datetime(),
  id: z.uuid(),
  state: z.enum([
    "prediction_open",
    "evidence_open",
    "completed",
    "failed",
    "expired",
    "cancelled",
  ]),
})
const todaySchema = z.object({ goal: goalSchema })
const evidenceContractSchema = z.object({
  evidence: z.array(
    z.object({
      attempt_number: z.number().int().min(1).max(2),
      content_type: z.string(),
      receipt_id: z.uuid(),
      state: z.enum(["pending", "accepted", "rejected", "inconclusive"]),
    }),
  ),
  objectCount: z.number().int().nonnegative(),
})

export type EvidenceContract = Readonly<z.infer<typeof evidenceContractSchema>>
export type EvidenceScenario = {
  readonly evidenceDeadlineAt: string
  readonly goalId: string
}

export const GUIDED_PHOTO = {
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
  mimeType: "image/png",
  name: "today-study-note.png",
} as const

export async function openEvidenceScenario(
  page: Page,
  request: APIRequestContext,
  email: string,
): Promise<EvidenceScenario> {
  await resetScenario(request)
  await page.goto("/")
  const account = await signupThroughUi(page, email)
  await page.getByRole("button", { name: "오늘 목표 만들기" }).click()
  await expect(page.getByRole("heading", { name: "서버가 확정한 오늘 목표" })).toBeVisible()
  const todayResponse = await request.get(`${WEB_ORIGIN}/v1/goals/today`, {
    headers: { "x-subject-key": account.subjectKey },
  })
  expect(todayResponse.status()).toBe(200)
  const today = todaySchema.parse(await todayResponse.json())
  const openResponse = await request.post(
    `${API_ORIGIN}/__e2e/goals/${today.goal.id}/evidence-open`,
  )
  expect(openResponse.status()).toBe(200)
  await page.reload()
  await expect(page.getByRole("heading", { name: "학습 노트 사진 제출" })).toBeVisible()
  return { evidenceDeadlineAt: today.goal.evidenceDeadlineAt, goalId: today.goal.id }
}

export async function prepareGuidedPhoto(page: Page): Promise<void> {
  await page.getByLabel("사진 제출과 운영자 검토에 동의합니다").check()
  await page.getByRole("button", { name: "10분 코드 받기" }).click()
  await expect(page.getByTestId("evidence-challenge-code")).toContainText(/^PR-[A-F0-9]{8}$/)
  await expect(page.getByTestId("evidence-challenge-timer")).toContainText("10:00")
  await page.getByLabel("학습 노트 사진 선택").setInputFiles(GUIDED_PHOTO)
  await expect(page.getByAltText("선택한 학습 노트 사진 미리보기")).toBeVisible()
}

export async function readEvidenceContract(
  request: APIRequestContext,
  goalId: string,
): Promise<EvidenceContract> {
  const response = await request.get(`${API_ORIGIN}/__e2e/evidence/${goalId}/contract`)
  expect(response.status()).toBe(200)
  return evidenceContractSchema.parse(await response.json())
}

export async function setEvidenceVerdict(
  request: APIRequestContext,
  evidenceId: string,
  verdict:
    | {
        readonly reasonCode: "challenge_not_visible" | "notes_insufficient" | "recipe_mismatch"
        readonly state: "rejected"
      }
    | {
        readonly reasonCode: "image_unreadable" | "review_unavailable"
        readonly state: "inconclusive"
      },
): Promise<void> {
  const response = await request.post(`${API_ORIGIN}/__e2e/evidence/${evidenceId}/verdict`, {
    data: verdict,
  })
  expect(response.status()).toBe(200)
}
