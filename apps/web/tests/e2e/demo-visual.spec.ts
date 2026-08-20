import path from "node:path"
import { expect, type Page, test } from "@playwright/test"

const evidenceDir = path.resolve(
  import.meta.dirname,
  "../../../../.omo/evidence/demo/mobile-prototype",
)

async function settleForCapture(page: Page): Promise<void> {
  await page.mouse.move(370, 8)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.scrollTo(0, 0)
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  await page.waitForTimeout(300)
}

async function capture(page: Page, name: string): Promise<void> {
  await settleForCapture(page)
  const outputPath = path.join(evidenceDir, `element-${name}.png`)
  if ((page.viewportSize()?.width ?? 0) <= 390) {
    await page.screenshot({ animations: "allow", path: outputPath })
    return
  }
  await page.locator(".demoViewport").screenshot({ animations: "disabled", path: outputPath })
}

async function choosePrediction(page: Page, choice: "no" | "yes" = "yes"): Promise<void> {
  const card = page.locator(".predictionCard")
  const goalId = await card.getAttribute("data-goal-id")
  if (goalId === null) throw new TypeError("prediction card has no goal id")
  await card.focus()
  await card.press(choice === "yes" ? "ArrowLeft" : "ArrowRight")
  await expect(card).not.toHaveAttribute("data-goal-id", goalId)
}

async function completePredictions(page: Page): Promise<void> {
  for (let card = 0; card < 5; card += 1) {
    await choosePrediction(page)
  }
  await expect(page.getByText("50,700P", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "내 목표", exact: true }).click()
  await expect(page.getByRole("heading", { name: "내 목표 상장하기" })).toBeVisible()
  await page.getByLabel("오늘의 목표").fill("정보처리기사 3장 요약")
}

async function loginDemo(page: Page): Promise<void> {
  await page.getByLabel("이메일").fill("demo@polyroutine.app")
  await page.getByLabel("비밀번호").fill("routine123")
  await page.getByRole("button", { name: "로그인", exact: true }).click()
  await expect(page.getByRole("heading", { name: "가능할지 골라요" })).toBeVisible()
}

async function openGoalAnalysis(page: Page): Promise<void> {
  await completePredictions(page)
  await page.getByRole("button", { name: "성공 확률 분석하기" }).click()
  await expect(page.getByText("77%", { exact: true })).toBeVisible()
}

async function openListedGoal(page: Page): Promise<void> {
  await openGoalAnalysis(page)
  await page.getByRole("button", { name: "이 목표 상장하기" }).click()
}

async function openVerification(page: Page): Promise<void> {
  await openListedGoal(page)
  await page.getByRole("button", { name: "사진 인증하기" }).click()
}

async function uploadProofPhoto(page: Page): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "goal-proof.png",
  })
}

test("captures every settled mobile prototype state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize({ height: 812, width: 375 })

  await page.goto("/demo")
  await capture(page, "login-375")
  await page.getByRole("button", { name: "회원가입", exact: true }).click()
  await capture(page, "signup-375")
  await page.getByRole("button", { name: "로그인으로 돌아가기" }).click()
  await loginDemo(page)
  await capture(page, "predict-375")
  for (let card = 0; card < 2; card += 1) {
    await choosePrediction(page)
  }
  await expect(page.getByRole("list", { name: "묶음 목표" })).toBeVisible()
  await capture(page, "predict-bundle-375")
  for (let card = 0; card < 3; card += 1) {
    await choosePrediction(page)
  }
  await expect(page.getByText("50,700P", { exact: true })).toBeVisible()
  await capture(page, "reward-complete-375")

  await page.goto("/demo")
  await loginDemo(page)
  await completePredictions(page)
  await page.getByRole("button", { name: "성공 확률 분석하기" }).click()
  await expect(page.getByRole("button", { name: "목표 분석 중" })).toBeDisabled()
  await capture(page, "goal-analyzing-375")
  await expect(page.getByText("77%", { exact: true })).toBeVisible()
  await capture(page, "goal-375")

  await page.goto("/demo")
  await loginDemo(page)
  await page.getByRole("button", { name: "내 목표", exact: true }).click()
  const goalInput = page.getByLabel("오늘의 목표")
  for (const goal of ["정보처리기사 3장 요약", "영어 단어 20개 복습", "30분 달리기"]) {
    await goalInput.fill(goal)
    await page.getByRole("button", { name: "목표 추가" }).click()
  }
  await capture(page, "goal-list-375")
  await page.getByRole("button", { name: "성공 확률 분석하기" }).click()
  await expect(page.getByRole("button", { name: "이 목표 상장하기" })).toBeVisible()
  await page.getByRole("button", { name: "이 목표 상장하기" }).click()
  await capture(page, "listed-multi-375")

  await page.goto("/demo")
  await loginDemo(page)
  await openListedGoal(page)
  await capture(page, "listed-375")

  await page.goto("/demo")
  await loginDemo(page)
  await openVerification(page)
  await capture(page, "verify-375")

  await page.goto("/demo")
  await loginDemo(page)
  await openVerification(page)
  await uploadProofPhoto(page)
  await page.getByRole("button", { name: "사진 인증하기" }).click()
  await expect(page.getByRole("heading", { name: "인증이 끝났어요" })).toBeVisible()
  await capture(page, "verified-375")

  await page.getByRole("button", { name: "정산 결과 보기" }).click()
  await capture(page, "settle-375")
  await page.getByRole("button", { name: "포인트", exact: true }).click()
  await capture(page, "points-375")
  await page.getByRole("button", { name: "출석체크" }).click()
  await capture(page, "attendance-375")
  await page.getByRole("button", { name: "닫기" }).click()
  await page.getByRole("button", { name: "예측 결과 정산하기" }).click()
  await capture(page, "points-settled-375")
  await page.locator(".demoScrollableScreen").evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await capture(page, "shop-catalog-bottom-375")
  await page.locator(".demoScrollableScreen").evaluate((element) => {
    element.scrollTop = 0
  })
  await page.getByRole("button", { name: "GS25 모바일 상품권 1천원권 50,000P로 구매" }).click()
  await capture(page, "shop-confirm-375")
  await page.getByRole("button", { name: "구매하기", exact: true }).click()
  await capture(page, "shop-purchased-375")
  await page.getByRole("button", { name: "MY", exact: true }).click()
  await capture(page, "profile-375")
  await page.getByRole("button", { name: "닉네임 변경" }).click()
  await capture(page, "profile-edit-375")
})

test("captures the centered phone on desktop", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize({ height: 900, width: 1280 })
  await page.goto("/demo")
  await loginDemo(page)
  const phone = await page.locator(".demoViewport").boundingBox()
  expect(phone?.width).toBe(390)
  expect(phone?.height).toBe(844)
  await page.mouse.move(1270, 8)
  await settleForCapture(page)
  await page.screenshot({
    animations: "disabled",
    path: path.join(evidenceDir, "viewport-phone-1280.png"),
  })
  await capture(page, "phone-1280")
})

test("captures the swipe feedback sequence", async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")
  await loginDemo(page)
  const card = page.locator(".predictionCard")

  await settleForCapture(page)
  const box = await card.boundingBox()
  if (box === null) throw new TypeError("prediction card is not visible")
  await page.screenshot({
    path: path.join(evidenceDir, "proof-swipe-rest-v3-375.png"),
  })
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 96, box.y + box.height / 2, { steps: 4 })
  const draggedBox = await card.boundingBox()
  if (draggedBox === null) throw new TypeError("dragged card is not visible")
  expect(draggedBox.x).toBeLessThan(box.x - 70)
  const centerY = box.y + box.height / 2
  const draggedCenterY = draggedBox.y + draggedBox.height / 2
  expect(Math.abs(draggedCenterY - centerY)).toBeLessThan(4)
  await page.evaluate(() => window.scrollTo(0, 0))
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  const topBar = await page.locator(".demoTopBar").boundingBox()
  const bottomNav = await page.getByRole("navigation", { name: "하단 메뉴" }).boundingBox()
  expect(topBar?.y).toBe(0)
  expect((bottomNav?.y ?? 812) + (bottomNav?.height ?? 0)).toBeLessThanOrEqual(812)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(card).toHaveAttribute("data-swipe", "idle")
  await card.evaluate((node) => {
    node.style.setProperty("--swipe-x", "-96px")
    node.style.setProperty("--swipe-rotation", "-4deg")
    node.setAttribute("data-dragging", "true")
    node.setAttribute("data-swipe", "yes")
  })
  await page.screenshot({
    fullPage: false,
    path: path.join(evidenceDir, "proof-swipe-mid-v3-375.png"),
  })
  await card.evaluate((node) => {
    node.style.setProperty("--swipe-x", "0px")
    node.style.setProperty("--swipe-rotation", "0deg")
    node.setAttribute("data-dragging", "false")
    node.setAttribute("data-swipe", "idle")
  })
  await choosePrediction(page)
  await expect(page.getByText("51,100P", { exact: true })).toBeVisible()
  await settleForCapture(page)
  await page.screenshot({
    path: path.join(evidenceDir, "proof-swipe-settled-v3-375.png"),
  })
})
