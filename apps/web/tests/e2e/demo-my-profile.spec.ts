import { writeFileSync } from "node:fs"
import path from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { createInitialDemoState, reduceDemoState } from "../../lib/demo-state"
import {
  createDemoPersistenceSnapshot,
  DEMO_STATE_STORAGE_KEY,
  demoPersistenceSchema,
} from "../../lib/demo-state/persistence"

const evidenceDir = path.resolve(
  import.meta.dirname,
  "../../../../.omo/evidence/polyroutine-demo-next-iteration",
)

function activitySnapshot(email: string, nickname: string) {
  let index = 0
  const dependencies = {
    createId: () => {
      index += 1
      return `my-e2e-${index}`
    },
    now: () => new Date(`2026-08-21T09:00:${String(index).padStart(2, "0")}.000Z`),
  }
  let state = reduceDemoState(
    createInitialDemoState(dependencies),
    {
      titles: [
        "알고리즘 문제 세 개를 끝까지 풀고 풀이 정리하기",
        "저녁에 한강을 따라 삼십 분 동안 달리기",
      ],
      type: "replace_goals",
    },
    dependencies,
  )
  state = reduceDemoState(state, { nickname, type: "update_profile" }, dependencies)
  state = reduceDemoState(
    state,
    {
      cardId: "settled-card",
      cardLabel: "책 한 장 읽고 메모하기",
      choice: "yes",
      crowdPercentage: 40,
      fixtureOutcome: "yes",
      roundId: state.round.id,
      stake: 100,
      type: "place_market_position",
    },
    dependencies,
  )
  state = reduceDemoState(
    state,
    { roundId: state.round.id, type: "settle_market_round" },
    dependencies,
  )
  state = reduceDemoState(
    state,
    {
      cardId: "pending-card",
      cardLabel: "물 두 병 마시기",
      choice: "no",
      crowdPercentage: 25,
      fixtureOutcome: "yes",
      roundId: state.round.id,
      stake: 100,
      type: "place_market_position",
    },
    dependencies,
  )
  state = reduceDemoState(
    state,
    {
      catalogId: "starbucks-americano",
      cost: 1_000,
      label: "스타벅스 카페 아메리카노 T",
      type: "purchase_coupon",
    },
    dependencies,
  )
  const firstCoupon = state.coupons[0]
  if (firstCoupon === undefined) throw new TypeError("activity coupon was not created")
  state = reduceDemoState(state, { couponId: firstCoupon.id, type: "use_coupon" }, dependencies)
  state = reduceDemoState(
    state,
    {
      catalogId: "gs25-mobile-gift-1000",
      cost: 1_000,
      label: "GS25 모바일 상품권 1천원권",
      type: "purchase_coupon",
    },
    dependencies,
  )
  return createDemoPersistenceSnapshot(true, email, state)
}

async function stored(page: Page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), DEMO_STATE_STORAGE_KEY)
  if (raw === null) throw new TypeError("demo snapshot is missing")
  return demoPersistenceSchema.parse(JSON.parse(raw))
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 })
})

test("MY profile persists activity and reset remains scoped", async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  await page.goto("/demo?demoNow=2026-08-21T12%3A00%3A00%2B09%3A00&demoIdPrefix=my-profile")

  const loginEmail = page.getByLabel("이메일")
  const loginPassword = page.getByLabel("비밀번호")
  await expect(loginEmail).toHaveValue("")
  await expect(loginPassword).toHaveValue("")
  await expect(loginEmail).toBeFocused()
  expect(
    await loginEmail.evaluate((input) => {
      const style = getComputedStyle(input)
      return {
        hasVisibleBorder:
          style.borderTopColor !== "transparent" && style.borderTopColor !== "rgba(0, 0, 0, 0)",
        outlineStyle: style.outlineStyle,
      }
    }),
  ).toEqual({ hasVisibleBorder: true, outlineStyle: "none" })
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDir, "task-11-auth-375.png"),
  })
  await expect(page.getByRole("button", { name: "로그인", exact: true })).toBeDisabled()
  await loginEmail.fill("invalid-email")
  await loginPassword.fill("x")
  await page.getByRole("button", { name: "로그인", exact: true }).click()
  await expect(page.getByText("이메일 형식을 확인해 주세요.")).toBeVisible()

  await page.getByRole("button", { name: "회원가입", exact: true }).click()
  await expect(page.getByRole("button", { name: "회원가입", exact: true })).toBeDisabled()
  await page.locator("form.demoLoginForm").evaluate((form: HTMLFormElement) => form.requestSubmit())
  await expect(page.getByLabel("닉네임")).toHaveValue("")
  await expect(page.getByLabel("이메일")).toHaveValue("")
  await expect(page.getByLabel("비밀번호")).toHaveValue("")
  await expect(page.getByText("닉네임을 입력해 주세요.")).toBeVisible()

  const email = "routine@example.com"
  await page.getByLabel("닉네임").fill("루틴지킴이")
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호").fill("never-persist-this")
  await page.getByRole("button", { name: "회원가입", exact: true }).click()
  await page.getByRole("button", { name: "MY", exact: true }).click()

  const nickname = "매일목표끝까지해내는루틴지킴이"
  const editTrigger = page.getByRole("button", { name: "닉네임 변경" })
  await editTrigger.click()
  const editDialog = page.getByRole("dialog", { name: "닉네임 변경" })
  await expect(editDialog.getByLabel("새 닉네임")).toBeFocused()
  const editBox = await editDialog.boundingBox()
  if (editBox === null) throw new TypeError("nickname dialog geometry is missing")
  expect(Math.round(editBox.x)).toBe(0)
  expect(Math.round(editBox.width)).toBe(375)
  expect(Math.round(editBox.y + editBox.height)).toBe(812)
  expect(await editDialog.evaluate((dialog) => getComputedStyle(dialog).boxShadow)).toMatch(
    /0px -2px 12px/,
  )
  await editDialog.getByLabel("새 닉네임").fill(nickname)
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDir, "task-11-nickname-375.png"),
  })
  await editDialog.getByRole("button", { name: "저장" }).click()
  await expect(editTrigger).toBeFocused()
  await page.reload()
  await page.getByRole("button", { name: "MY", exact: true }).click()
  const nicknameHeading = page.getByRole("heading", { name: nickname })
  await expect(nicknameHeading).toBeVisible()
  expect(await nicknameHeading.locator("span").allTextContents()).toEqual([
    "매일목표끝까지",
    "해내는루틴지킴이",
  ])

  const seeded = activitySnapshot(email, nickname)
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: DEMO_STATE_STORAGE_KEY,
    value: seeded,
  })
  await page.reload()
  await page.getByRole("button", { name: "MY", exact: true }).click()
  await expect(
    page.getByText("등록한 목표", { exact: true }).locator("..").getByText("2개", { exact: true }),
  ).toBeVisible()
  await expect(page.getByText("진행 1 · 정산 1", { exact: true })).toBeVisible()
  await expect(page.getByText(/P · 5건$/)).toBeVisible()
  await expect(page.getByText("사용 가능 1 · 사용 1", { exact: true })).toBeVisible()
  const details = page.locator('section[aria-label="내 활동 내역"] > details')
  await expect(details).toHaveCount(3)
  await expect(details.nth(0)).not.toHaveAttribute("open", "")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDir, "task-11-my-375.png"),
  })
  await page.getByText("포인트 내역", { exact: true }).click()
  await expect(page.getByText("상품 구매", { exact: true }).first()).toBeVisible()
  await page.getByText("내 예측", { exact: true }).click()
  await expect(page.getByText("물 두 병 마시기", { exact: true })).toBeVisible()
  await page.getByText("쿠폰 내역", { exact: true }).click()
  await expect(page.getByText("스타벅스 카페 아메리카노 T", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  const serializedBeforeLogout = JSON.stringify(await stored(page))
  expect(serializedBeforeLogout).not.toMatch(/never-persist-this|password/i)
  await page.getByRole("button", { name: "로그아웃" }).click()
  await expect(page.getByLabel("이메일")).toHaveValue("")
  await expect(page.getByLabel("비밀번호")).toHaveValue("")
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호").fill("another-ephemeral-password")
  await page.getByRole("button", { name: "로그인", exact: true }).click()
  await page.getByRole("button", { name: "MY", exact: true }).click()
  await expect(page.getByText("진행 1 · 정산 1", { exact: true })).toBeVisible()

  await page.evaluate(() => localStorage.setItem("unrelated-sentinel", "keep-me"))
  const resetTrigger = page.getByRole("button", { name: "데이터 초기화" })
  await resetTrigger.click()
  const resetDialog = page.getByRole("dialog", { name: "모든 데이터를 초기화할까요?" })
  const resetBox = await resetDialog.boundingBox()
  if (resetBox === null) throw new TypeError("reset dialog geometry is missing")
  expect(Math.round(resetBox.x)).toBe(0)
  expect(Math.round(resetBox.width)).toBe(375)
  expect(Math.round(resetBox.y + resetBox.height)).toBe(812)
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDir, "task-11-reset-375.png"),
  })
  await page.keyboard.press("Escape")
  await expect(resetTrigger).toBeFocused()
  expect((await stored(page)).state.goals).toHaveLength(2)
  await resetTrigger.click()
  await resetDialog.getByRole("button", { name: "취소" }).click()
  await expect(resetTrigger).toBeFocused()
  await resetTrigger.click()
  await resetDialog.getByRole("button", { name: "초기화하기" }).click()
  await expect(page.getByLabel("이메일")).toHaveValue("")
  await expect(page.getByLabel("비밀번호")).toHaveValue("")
  await expect(page.getByLabel("이메일")).toBeFocused()
  expect(await page.evaluate((key) => localStorage.getItem(key), DEMO_STATE_STORAGE_KEY)).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem("unrelated-sentinel"))).toBe("keep-me")
  expect(runtimeErrors).toEqual([])

  writeFileSync(
    path.join(evidenceDir, "task-11-profile.json"),
    `${JSON.stringify({ nickname, runtimeErrors, serializedBeforeLogout }, null, 2)}\n`,
  )
})
