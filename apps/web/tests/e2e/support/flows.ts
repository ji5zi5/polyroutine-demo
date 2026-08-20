import { type APIRequestContext, expect, type Locator, type Page } from "@playwright/test"
import { z } from "zod"

export const API_ORIGIN = "http://127.0.0.1:3101"
export const WEB_ORIGIN = "http://127.0.0.1:3100"
export const TEST_PASSWORD = "correct horse battery staple"

const sessionSchema = z.object({
  csrfToken: z.string(),
  expiresAt: z.string(),
  token: z.string(),
})
const accountSchema = z.object({
  session: sessionSchema,
  subjectKey: z.string(),
})

export type TestAccount = z.infer<typeof accountSchema>

function signupPayload(email: string) {
  return {
    adultSelfAttested: true,
    email,
    password: TEST_PASSWORD,
    privacyVersion: "2026-08-19",
    termsVersion: "2026-08-19",
    timezone: "Asia/Seoul",
  } as const
}

export async function resetScenario(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${API_ORIGIN}/__e2e/reset`)
  expect(response.status()).toBe(200)
}

export async function setServerTime(request: APIRequestContext, iso: string): Promise<void> {
  const response = await request.post(`${API_ORIGIN}/__e2e/clock`, { data: { iso } })
  expect(response.status()).toBe(200)
}

export async function signupThroughUi(page: Page, email: string): Promise<TestAccount> {
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호").fill(TEST_PASSWORD)
  await page.getByLabel("만 18세 이상입니다").check()
  await page.getByLabel("이용약관과 개인정보 처리방침에 동의합니다").check()
  await page.getByRole("button", { name: "성인으로 시작하기" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "오늘의 루틴" })).toBeVisible()
  return accountSchema.parse(
    JSON.parse(
      await page.evaluate(() => localStorage.getItem("poly-routine-session:v1") ?? "null"),
    ),
  )
}

export async function signupThroughApi(
  request: APIRequestContext,
  email: string,
): Promise<TestAccount> {
  const response = await request.post(`${WEB_ORIGIN}/v1/accounts/signup`, {
    data: signupPayload(email),
  })
  expect(response.status()).toBe(201)
  return accountSchema.parse(await response.json())
}

export async function createGoal(
  request: APIRequestContext,
  account: TestAccount,
  noteLineTarget = 3,
): Promise<void> {
  const response = await request.post(`${WEB_ORIGIN}/v1/goals`, {
    data: { noteLineTarget, studyMinutes: 25 },
    headers: { "x-subject-key": account.subjectKey },
  })
  expect(response.status()).toBe(201)
}

export async function createEligibleGoals(
  request: APIRequestContext,
  prefix: string,
  count: number,
): Promise<readonly TestAccount[]> {
  const accounts: TestAccount[] = []
  for (let index = 0; index < count; index += 1) {
    const account = await signupThroughApi(request, `${prefix}-${index}@example.test`)
    await createGoal(request, account, 3 + (index % 3))
    accounts.push(account)
  }
  return accounts
}

export async function predictionCount(
  request: APIRequestContext,
  subjectKey: string,
): Promise<number> {
  const response = await request.get(
    `${API_ORIGIN}/__e2e/predictions/${encodeURIComponent(subjectKey)}/count`,
  )
  expect(response.status()).toBe(200)
  return z.object({ count: z.number().int() }).parse(await response.json()).count
}

export async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let presses = 0; presses < 24; presses += 1) {
    await page.keyboard.press("Tab")
    if (await target.evaluate((element) => element === document.activeElement)) return
  }
  throw new Error(`Keyboard focus did not reach ${await target.getAttribute("aria-label")}`)
}
