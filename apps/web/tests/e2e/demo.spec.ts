import { expect, type Page, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.route("**/api/demo/goal-analysis", async (route) => {
    const request = route.request().postDataJSON() as { goals?: readonly string[] }
    const joinedGoals = request.goals?.join(" ") ?? ""
    const probability = joinedGoals.includes("산책")
      ? 41
      : joinedGoals.includes("영어 공부")
        ? 62
        : 77
    await new Promise<void>((resolve) => setTimeout(resolve, 150))
    await route.fulfill({
      contentType: "application/json",
      json: {
        confidence: "high",
        factors: ["목표의 구체성과 분량을 함께 살펴봤어요"],
        probability,
        source: "fallback",
      },
      status: 200,
    })
  })
})

async function loginDemo(page: Page): Promise<void> {
  await page.getByLabel("이메일").fill("demo@polyroutine.app")
  await page.getByLabel("비밀번호").fill("routine123")
  await page.getByRole("button", { name: "로그인", exact: true }).click()
}

async function enterDemoGoal(page: Page): Promise<void> {
  await page.getByLabel("오늘의 목표").fill("정보처리기사 3장 요약")
}

async function choosePrediction(page: Page, choice: "no" | "yes"): Promise<void> {
  const card = page.locator(".predictionCard")
  const goalId = await card.getAttribute("data-goal-id")
  if (goalId === null) throw new TypeError("prediction card has no goal id")
  await card.focus()
  await card.press(choice === "yes" ? "ArrowLeft" : "ArrowRight")
  await expect(card).not.toHaveAttribute("data-goal-id", goalId)
}

test("demo completes the mobile prediction routine", async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))

  // Given: the mobile prototype starts on the first prediction card.
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")
  await expect(page.getByRole("heading", { name: "오늘도 가볍게 시작해요" })).toBeVisible()
  await expect(page.getByLabel("이메일")).toHaveValue("")
  await expect(page.getByLabel("비밀번호")).toHaveValue("")
  await expect(page.getByRole("button", { name: "로그인", exact: true })).toBeDisabled()
  await loginDemo(page)
  await expect(page.getByRole("heading", { name: "가능할지 골라요" })).toBeVisible()
  await expect(page.getByText("51,200P", { exact: true })).toBeVisible()
  await expect(page.getByText("가능 64%", { exact: true })).toBeVisible()
  await expect(page.getByText("불가능 36%", { exact: true })).toBeVisible()
  await expect(page.locator(".predictionCardPreview")).toHaveCount(1)
  await expect(page.locator(".swipeActions")).toHaveCount(0)
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toBeVisible()

  // When: the first card is swiped right.
  const activeCard = page.locator(".predictionCard")
  const cardBox = await activeCard.boundingBox()
  expect(cardBox).not.toBeNull()
  if (cardBox === null) throw new TypeError("prediction card is not visible")

  // Left means 가능, while right means 불가능.
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(cardBox.x + cardBox.width / 2 - 40, cardBox.y + cardBox.height / 2)
  await expect(activeCard).toHaveAttribute("data-swipe", "yes")
  await page.mouse.up()
  await expect(activeCard).toHaveAttribute("data-swipe", "idle")

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(cardBox.x + cardBox.width - 24, cardBox.y + cardBox.height / 2, {
    steps: 6,
  })
  await page.mouse.up()

  // Then: the next card replaces it and the full four-screen demo can finish.
  await expect(page.getByText("51,100P", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "책 15쪽 읽고 3줄 요약하기" })).toBeVisible()
  await choosePrediction(page, "no")
  await choosePrediction(page, "yes")
  await choosePrediction(page, "yes")
  await choosePrediction(page, "no")

  await expect(page.getByRole("heading", { name: "가능할지 골라요" })).toBeVisible()
  await expect(page.getByText("50,700P", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "포트폴리오 소개 5줄 다듬기" })).toBeVisible()
  await choosePrediction(page, "yes")
  await expect(page.getByText("50,600P", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "잠들기 전 스트레칭 15분 하기" })).toBeVisible()
  await page.getByRole("button", { name: "내 목표", exact: true }).click()
  await expect(page.getByRole("heading", { name: "내 목표 상장하기" })).toBeVisible()
  await expect(page.getByLabel("오늘의 목표")).toHaveValue("")
  await enterDemoGoal(page)
  await page.getByRole("button", { name: "성공 확률 분석하기" }).click()
  await expect(page.getByRole("button", { name: "목표 분석 중" })).toBeDisabled()
  await expect(page.getByText("77%", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "이 목표 상장하기" }).click()

  await expect(page.getByRole("heading", { name: "오늘 내 목표" })).toBeVisible()
  await expect(page.getByText("상장 완료", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "사진 인증하기" }).click()

  await expect(page.getByRole("heading", { name: "사진 인증" })).toBeVisible()
  await expect(page.getByRole("button", { name: "사진 확인하기" })).toBeDisabled()
  const photoInput = page.locator('input[type="file"]')
  await photoInput.setInputFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "goal-proof.png",
  })
  await expect(page.getByRole("img", { name: "선택한 사진 미리보기" })).toBeVisible()
  await page.getByRole("button", { name: "사진 확인하기" }).click()
  await expect(page.getByText("파일 형식과 미리보기를 확인했어요.")).toBeVisible()
  await page.getByRole("button", { name: "정산 결과 보기" }).click()

  await expect(page.getByRole("heading", { name: "오늘의 정산" })).toBeVisible()
  await expect(page.getByText("+200점", { exact: true })).toBeVisible()
  await expect(page.getByText("반전 가산점 ×2.0", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "예측", exact: true }).click()
  await expect(page.getByText("50,800P", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "포인트", exact: true }).click()
  await expect(page.getByRole("heading", { name: "내 포인트" })).toBeVisible()
  await expect(page.getByText("50,800점", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "예측 결과 정산하기" }).click()
  await expect(page.getByText("적중 정산 +451P", { exact: true })).toBeVisible()
  await expect(page.getByText("51,251점", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "포인트 상점" })).toBeVisible()
  await expect(page.locator("[data-shop-product]")).toHaveCount(8)
  await expect(page.getByText("1,500,000P", { exact: true })).toBeVisible()
  await expect(page.getByRole("img", { name: "스타벅스 아이스 카페 라떼T" })).toBeVisible()
  await expect(page.getByRole("img", { name: "네이버페이 포인트 10,000원" })).toBeVisible()
  await page.getByRole("button", { name: "GS25 모바일 상품권 1천원권 50,000P로 구매" }).click()
  await expect(page.getByRole("dialog", { name: "GS25 모바일 상품권 1천원권" })).toBeVisible()
  await page.getByRole("button", { name: "구매하기", exact: true }).click()
  await expect(page.getByText("1,251점", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "MY", exact: true }).click()
  await expect(page.getByRole("heading", { name: "내 정보" })).toBeVisible()
  await page.getByText("쿠폰 내역", { exact: true }).click()
  await expect(page.getByRole("heading", { name: "사용 가능 1개" })).toBeVisible()
  await expect(page.getByText("GS25 모바일 상품권 1천원권", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "로그아웃", exact: true }).click()
  await expect(page.getByRole("heading", { name: "오늘도 가볍게 시작해요" })).toBeVisible()

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(layout.scrollWidth).toBe(layout.clientWidth)
  expect(runtimeErrors).toEqual([])
})

test("points purchase a reward when the balance is sufficient", async ({ page }) => {
  // Given: a signed-in user has the initial demo balance.
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")
  await loginDemo(page)
  await page.getByRole("button", { name: "포인트", exact: true }).click()

  // When: the user confirms a 50,000-point reward purchase.
  await page.getByRole("button", { name: "GS25 모바일 상품권 1천원권 50,000P로 구매" }).click()
  await page.getByRole("button", { name: "구매하기", exact: true }).click()

  // Then: the balance is deducted once and the reward is marked purchased.
  await expect(page.getByText("1,200점", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "GS25 모바일 상품권 1천원권 50,000P로 구매" }),
  ).toBeVisible()
})

test("daily attendance refills market points once", async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")
  await loginDemo(page)
  await page.getByRole("button", { name: "포인트", exact: true }).click()

  await page.getByRole("button", { name: "출석체크" }).click()
  await expect(page.getByRole("dialog", { name: "8월 출석체크" })).toBeVisible()
  await page.getByRole("button", { name: "오늘 출석하기 · +200P" }).click()

  await expect(page.getByText("51,400점", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "오늘 출석 완료" })).toBeVisible()
  await page.getByRole("button", { name: "오늘 출석 완료" }).click()
  await expect(page.getByRole("button", { name: "오늘 출석 완료 · +200P" })).toBeDisabled()
})

test("skipping a market card spends no points", async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")
  await loginDemo(page)

  await page.getByRole("button", { name: "건너뛰기", exact: true }).click()

  await expect(page.getByText("51,200P", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "책 15쪽 읽고 3줄 요약하기" })).toBeVisible()
})

test("AI probability changes for different vague goals", async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")
  await loginDemo(page)
  await page.getByRole("button", { name: "내 목표", exact: true }).click()

  const goalInput = page.getByLabel("오늘의 목표")
  await goalInput.fill("산책하기")
  await page.getByRole("button", { name: "성공 확률 분석하기" }).click()
  const firstProbability = await page
    .getByLabel("AI 예상 성공 확률")
    .locator("strong")
    .textContent()

  await goalInput.fill("영어 공부하기")
  await page.getByRole("button", { name: "성공 확률 분석하기" }).click()
  const secondProbability = await page
    .getByLabel("AI 예상 성공 확률")
    .locator("strong")
    .textContent()

  expect(firstProbability).not.toBe(secondProbability)
})

test("AI estimate stays separate from the crowd prediction ratio", async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")
  await loginDemo(page)

  await expect(page.getByText("예시 모델 추정 59%", { exact: true })).toBeVisible()
  await expect(page.getByText("참여자 예측", { exact: true })).toBeVisible()
  await expect(page.getByText("가능 64%", { exact: true })).toBeVisible()
})

test("signup and profile nickname editing work like a real account", async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")

  await page.getByRole("button", { name: "회원가입", exact: true }).click()
  await expect(page.getByRole("heading", { name: "처음 오셨나요?" })).toBeVisible()
  await expect(page.getByLabel("닉네임")).toHaveValue("")
  await page.getByLabel("닉네임").fill("루틴 메이커")
  await page.getByLabel("이메일").fill("maker@polyroutine.app")
  await page.getByLabel("비밀번호").fill("routine123")
  await page.locator('.demoLoginForm button[type="submit"]').click()

  await page.getByRole("button", { name: "MY", exact: true }).click()
  await expect(page.getByRole("heading", { name: "루틴 메이커" })).toBeVisible()
  await page.getByRole("button", { name: "닉네임 변경" }).click()
  await expect(page.getByRole("dialog", { name: "닉네임 변경" })).toBeVisible()
  await page.getByLabel("새 닉네임").fill("꾸준한 수달")
  await page.getByRole("button", { name: "저장", exact: true }).click()

  await expect(page.getByRole("heading", { name: "꾸준한 수달" })).toBeVisible()
})

test("multiple goals can be added at once as a daily checklist", async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")
  await loginDemo(page)
  await page.getByRole("button", { name: "내 목표", exact: true }).click()

  const goalInput = page.getByLabel("오늘의 목표")
  for (const goal of ["정보처리기사 3장 요약", "영어 단어 20개 복습", "30분 달리기"]) {
    await goalInput.fill(goal)
    await page.getByRole("button", { name: "목표 추가" }).click()
  }
  await expect(page.getByRole("list", { name: "추가한 목표" }).getByRole("listitem")).toHaveCount(3)
  await page.getByRole("button", { name: "성공 확률 분석하기" }).click()
  await expect(page.getByLabel("AI 예상 성공 확률").locator("strong")).toContainText("%")
  await page.getByRole("button", { name: "이 목표 상장하기" }).click()

  await expect(page.getByRole("list", { name: "오늘의 할 일" }).getByRole("listitem")).toHaveCount(
    3,
  )
  await expect(page.getByText("영어 단어 20개 복습", { exact: true })).toBeVisible()
})

test("prediction feed has over one hundred varied cards including goal bundles", async ({
  page,
}) => {
  await page.goto("/demo")
  await loginDemo(page)

  const predictScreen = page.locator(".demoPredictScreen")
  await expect(predictScreen).toHaveAttribute("data-card-pool-size", "128")

  const seenGoalIds = new Set<string>()
  let bundleCards = 0
  for (let card = 0; card < 12; card += 1) {
    const activeCard = page.locator(".predictionCard")
    const goalId = await activeCard.getAttribute("data-goal-id")
    if (goalId === null) throw new TypeError("prediction card has no goal id")
    seenGoalIds.add(goalId)
    bundleCards += await activeCard.getByRole("list", { name: "묶음 목표" }).count()
    await page.getByRole("button", { name: "건너뛰기" }).click()
    await expect(activeCard).not.toHaveAttribute("data-goal-id", goalId)
  }

  expect(seenGoalIds.size).toBe(12)
  expect(bundleCards).toBeGreaterThan(0)
})
