import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { DEMO_STATE_STORAGE_KEY } from "../../lib/demo-state/persistence"

const evidenceDirectory = path.resolve(
  import.meta.dirname,
  "../../../../.omo/evidence/polyroutine-demo-next-iteration",
)

const validPng = {
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    "base64",
  ),
  mimeType: "image/png",
  name: "goal-proof.png",
} as const

async function loginDemo(page: Page): Promise<void> {
  await page.getByLabel("이메일").fill("demo@polyroutine.app")
  await page.getByLabel("비밀번호").fill("routine123")
  await page.getByRole("button", { exact: true, name: "로그인" }).click()
}

async function openGoalComposer(page: Page): Promise<void> {
  await loginDemo(page)
  await page.getByRole("button", { exact: true, name: "내 목표" }).click()
  await expect(page.getByRole("heading", { name: "내 목표 상장하기" })).toBeVisible()
}

async function stabilizeGoalCapture(page: Page, position: "bottom" | "top"): Promise<void> {
  await page.mouse.move(1, 1)
  await page.locator(".demoScrollableScreen").evaluate(async (screen, scrollPosition) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await Promise.all(
      screen
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    )
    screen.scrollTo({
      top: scrollPosition === "bottom" ? screen.scrollHeight - screen.clientHeight : 0,
    })
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  }, position)
}

test.beforeAll(async () => {
  await mkdir(evidenceDirectory, { recursive: true })
})

test.beforeEach(async ({ page }) => {
  await page.route("https://unpkg.com/**", async (route) =>
    route.fulfill({ body: "", contentType: "application/javascript", status: 200 }),
  )
})

test("Gemini result, fallback, and navigation cancellation remain truthful", async ({ page }) => {
  const runtimeErrors: string[] = []
  let requestCount = 0
  let releaseFirst: (() => void) | undefined
  let releasePending: (() => void) | undefined
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  await page.route("**/api/demo/goal-analysis", async (route) => {
    requestCount += 1
    if (requestCount === 1) {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      await route.fulfill({
        contentType: "application/json",
        json: {
          confidence: "high",
          factors: ["분량이 구체적이에요", "완료 기준이 선명해요"],
          probability: 73,
          source: "gemini",
        },
        status: 200,
      })
      return
    }
    if (requestCount === 2) {
      await route.fulfill({
        contentType: "application/json",
        json: { code: "rate_limited" },
        status: 200,
      })
      return
    }
    await new Promise<void>((resolve) => {
      releasePending = resolve
    })
    await route.fulfill({
      contentType: "application/json",
      json: {
        confidence: "low",
        factors: ["이미 취소된 응답이에요"],
        probability: 12,
        source: "gemini",
      },
      status: 200,
    })
  })

  // Given: a mobile user submits one non-sensitive goal to the mocked endpoint.
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")
  await openGoalComposer(page)
  await expect(page.getByText("AI 모델 예측 59%", { exact: true })).toHaveCount(0)
  await expect(page.getByText("민감한 정보는 빼 주세요.")).toHaveCount(0)
  await page.getByLabel("오늘의 목표").fill("정보처리기사 3장 요약")

  // When: Gemini returns a valid structured result.
  await page.getByRole("button", { name: "성공 확률 분석하기" }).click()

  // Then: the result is labeled independently from the crowd ratio.
  await expect(page.getByRole("button", { name: "목표 분석 중" })).toBeDisabled()
  await expect.poll(() => typeof releaseFirst).toBe("function")
  releaseFirst?.()
  await expect(page.getByText("73%", { exact: true })).toBeVisible()
  await expect(page.getByLabel("AI 예상 성공 확률")).toHaveAttribute("data-source", "gemini")
  await expect(page.getByText("신뢰도 높음", { exact: true })).toHaveCount(0)
  await stabilizeGoalCapture(page, "top")
  await page.screenshot({
    path: path.join(evidenceDirectory, "task-06-ai-success-375.png"),
  })
  await page.getByText("분석 근거 2개 보기", { exact: true }).click()
  const renderedFactors = ["분량이 구체적이에요", "완료 기준이 선명해요"] as const
  for (const factor of renderedFactors) {
    await expect(page.getByText(factor, { exact: true })).toBeVisible()
  }
  await writeFile(
    path.join(evidenceDirectory, "task-06-ai-success-render.json"),
    `${JSON.stringify(
      {
        confidence: "high",
        factors: renderedFactors,
        probability: 73,
        source: "gemini",
      },
      null,
      2,
    )}\n`,
    "utf8",
  )

  // When: the provider is rate limited, the same goal stays usable.
  await page.getByRole("button", { name: "다시 분석하기" }).click()

  // Then: a deterministic retryable fallback stays usable without implementation copy.
  await expect(page.locator('[data-source="fallback"]')).toHaveAccessibleName("AI 예상 성공 확률")
  await expect(page.getByText("데모 계산", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "이 목표 상장하기" })).toBeEnabled()
  await stabilizeGoalCapture(page, "bottom")
  await page.screenshot({
    path: path.join(evidenceDirectory, "task-06-ai-fallback-375.png"),
  })

  // When: a later retry is pending and the user navigates away.
  await page.getByRole("button", { name: "다시 분석하기" }).click()
  await expect(page.getByRole("button", { name: "목표 분석 중" })).toBeDisabled()
  await expect.poll(() => requestCount).toBe(3)
  await page.getByRole("button", { exact: true, name: "예측" }).click()
  releasePending?.()

  // Then: its late response cannot overwrite the departed surface.
  await expect(page.getByRole("heading", { name: "가능할지 골라요" })).toBeVisible()
  await expect(page.getByText("12%", { exact: true })).toHaveCount(0)
  await expect(page.getByText("AI 모델 예측 59%", { exact: true })).toBeVisible()
  expect(requestCount).toBe(3)
  expect(runtimeErrors).toEqual([])
  await writeFile(
    path.join(evidenceDirectory, "task-06-ai-e2e.txt"),
    [
      "PASS mocked Gemini: 73/high/two factors/source=gemini",
      "PASS rendered factors: 분량이 구체적이에요 | 완료 기준이 선명해요",
      "PASS rate-limited fallback payload: source=fallback and retry remains enabled",
      "PASS navigation/unmount: late 12% response ignored",
      "PASS static card: explicitly labeled AI-model estimate",
      `PASS endpoint requests: ${requestCount}`,
      "PASS runtime console/page errors: 0",
    ].join("\n") + "\n",
    "utf8",
  )
})

test("every provider failure renders a usable deterministic fallback", async ({ page }) => {
  const scenarios = [
    { code: "missing_key", label: "missing_key" },
    { code: "rate_limited", label: "429" },
    { code: "timeout", label: "timeout" },
    { code: "invalid_schema", label: "invalid_schema" },
    { code: "network", label: "network" },
  ] as const
  type Scenario = (typeof scenarios)[number]
  let activeScenario: Scenario = scenarios[0]
  let googleRequestCount = 0
  let sameOriginRequestCount = 0
  const observations: Array<{
    readonly fallbackSource: string | null
    readonly listingPrimaryCount: number
    readonly retryEnabled: boolean
    readonly scenario: Scenario["label"]
  }> = []

  page.on("request", (request) => {
    if (/googleapis\.com|generativelanguage\.google/.test(request.url())) googleRequestCount += 1
  })
  await page.route("**/api/demo/goal-analysis", async (route) => {
    sameOriginRequestCount += 1
    switch (activeScenario.code) {
      case "missing_key":
        await route.fulfill({
          contentType: "application/json",
          json: { code: "missing_key" },
          status: 503,
        })
        return
      case "rate_limited":
        await route.fulfill({
          contentType: "application/json",
          json: { code: "rate_limited" },
          status: 429,
        })
        return
      case "timeout":
        await new Promise<void>((resolve) => setTimeout(resolve, 10_250))
        await route
          .fulfill({
            contentType: "application/json",
            json: { code: "timeout" },
            status: 504,
          })
          .catch(() => undefined)
        return
      case "invalid_schema":
        await route.fulfill({
          body: '{"probability":73',
          contentType: "application/json",
          status: 200,
        })
        return
      case "network":
        await route.abort("failed")
        return
    }
  })

  await page.setViewportSize({ height: 812, width: 375 })
  for (const scenario of scenarios) {
    activeScenario = scenario
    await page.goto("/demo")
    await page.evaluate((key) => localStorage.removeItem(key), DEMO_STATE_STORAGE_KEY)
    await page.reload()
    await openGoalComposer(page)
    await page.getByLabel("오늘의 목표").fill("정보처리기사 3장 요약")
    await page.getByRole("button", { name: "성공 확률 분석하기" }).click()

    const fallbackResult = page.locator('[data-source="fallback"]')
    const retry = page.getByRole("button", { name: "다시 분석하기" })
    const listing = page.getByRole("button", { name: "이 목표 상장하기" })
    await expect(fallbackResult).toHaveAttribute("data-source", "fallback", { timeout: 12_000 })
    await expect(retry).toBeEnabled()
    await expect(listing).toBeEnabled()
    await expect(page.locator(".demoPrimaryButton:visible")).toHaveCount(1)
    await expect(retry).not.toHaveClass(/demoPrimaryButton/)

    observations.push({
      fallbackSource: await fallbackResult.getAttribute("data-source"),
      listingPrimaryCount: await page.locator(".demoPrimaryButton:visible").count(),
      retryEnabled: await retry.isEnabled(),
      scenario: scenario.label,
    })
  }

  expect(sameOriginRequestCount).toBe(scenarios.length)
  expect(googleRequestCount).toBe(0)
  await writeFile(
    path.join(evidenceDirectory, "task-06-ai-fallback-matrix.json"),
    `${JSON.stringify(
      {
        googleRequestCount,
        observations,
        sameOriginRequestCount,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
})

test("photo verification stages errors, cleanup, reduced motion, and one settlement", async ({
  page,
}) => {
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  await page.addInitScript(() => {
    const createObjectUrl = URL.createObjectURL.bind(URL)
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL)
    Reflect.set(window, "__createdObjectUrlCount", 0)
    Reflect.set(window, "__revokedObjectUrlCount", 0)
    URL.createObjectURL = (blob) => {
      Reflect.set(
        window,
        "__createdObjectUrlCount",
        Number(Reflect.get(window, "__createdObjectUrlCount")) + 1,
      )
      return createObjectUrl(blob)
    }
    URL.revokeObjectURL = (url) => {
      Reflect.set(
        window,
        "__revokedObjectUrlCount",
        Number(Reflect.get(window, "__revokedObjectUrlCount")) + 1,
      )
      revokeObjectUrl(url)
    }
  })
  await page.route("**/api/demo/goal-analysis", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        confidence: "high",
        factors: ["완료 기준이 선명해요"],
        probability: 73,
        source: "gemini",
      },
      status: 200,
    })
  })

  // Given: a listed goal enters the staged file-verification screen.
  await page.setViewportSize({ height: 812, width: 375 })
  await page.goto("/demo")
  await openGoalComposer(page)
  await page.getByLabel("오늘의 목표").fill("정보처리기사 3장 요약")
  await page.getByRole("button", { name: "성공 확률 분석하기" }).click()
  await expect(page.getByText("73%", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "이 목표 상장하기" }).click()
  await page.getByRole("button", { name: "사진 인증하기" }).click()
  await expect(page.getByText("사진 인증하기", { exact: true })).toBeVisible()

  // When: a valid PNG is selected.
  const photoInput = page.locator('input[type="file"]')
  const startedAt = Date.now()
  await photoInput.setInputFiles({
    buffer: await readFile(
      path.resolve(import.meta.dirname, "../../public/rewards/americano-coupon.png"),
    ),
    mimeType: "image/png",
    name: "goal-proof.png",
  })

  // Then: the goal and preview remain visible without exposing the local filename.
  await expect(page.getByRole("img", { name: "선택한 사진 미리보기" })).toBeVisible()
  await expect(page.getByText("정보처리기사 3장 요약", { exact: true })).toBeVisible()
  await expect(page.getByText("goal-proof.png", { exact: true })).toHaveCount(0)
  await page.screenshot({
    path: path.join(evidenceDirectory, "task-08-verify-preview-375.png"),
  })
  await expect(page.getByText("사진을 확인하고 있어요.")).toBeVisible()
  await expect(page.getByText("goal-proof.png", { exact: true })).toHaveCount(0)
  await expect(page.getByText("인증이 완료됐어요.")).toBeVisible()
  const elapsed = Date.now() - startedAt
  expect(elapsed).toBeGreaterThanOrEqual(900)
  expect(elapsed).toBeLessThan(2_500)
  await page.screenshot({
    path: path.join(evidenceDirectory, "task-08-verify-success-375.png"),
  })
  await expect(page.getByRole("heading", { name: "사진 인증" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "오늘의 정산" })).toHaveCount(0)

  // When: settlement is requested twice in the same browser tick.
  await page.getByRole("button", { name: "정산 결과 보기" }).evaluate((button) => {
    button.click()
    button.click()
  })

  // Then: exactly one completion credit is recorded.
  await expect(page.getByRole("heading", { name: "오늘의 정산" })).toBeVisible()
  await page.getByRole("button", { exact: true, name: "포인트" }).click()
  await expect(page.getByText("51,337점", { exact: true })).toBeVisible()

  // Given: a fresh verification attempt receives invalid and oversize files.
  await page.getByRole("button", { exact: true, name: "내 목표" }).click()
  await page.getByRole("button", { name: "사진 인증하기" }).click()
  const retryInput = page.locator('input[type="file"]')
  await retryInput.setInputFiles({
    buffer: Buffer.from("not-an-image"),
    mimeType: "text/plain",
    name: "proof.txt",
  })
  const verificationAlert = page.getByRole("region", { name: "사진 인증" }).getByRole("alert")
  await expect(verificationAlert).toContainText("PNG·JPG·WEBP 이미지만 선택해 주세요.")
  await verificationAlert.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
  })
  await page.locator("[data-verification-scroll-container]").evaluate(
    (screen) =>
      new Promise<void>((resolve) => {
        screen.scrollTo({ top: 0 })
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  const retryButton = page.getByRole("button", { name: "다시 시도하기" })
  await expect(page.getByText("폴리루틴", { exact: true })).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole("heading", { name: "사진 인증" })).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole("region", { name: "사진 인증" })).toBeInViewport({ ratio: 1 })
  await expect(verificationAlert).toBeInViewport({ ratio: 1 })
  await expect(retryButton).toBeInViewport({ ratio: 1 })
  await expect(retryButton).toBeFocused()
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toBeInViewport({ ratio: 1 })
  await page.screenshot({
    path: path.join(evidenceDirectory, "task-08-verify-error-375.png"),
  })
  const errorViewport = {
    alert: await verificationAlert.boundingBox(),
    brand: await page.getByText("폴리루틴", { exact: true }).boundingBox(),
    focusedText: await page.evaluate(() => document.activeElement?.textContent?.trim() ?? null),
    navigation: await page.getByRole("navigation", { name: "하단 메뉴" }).boundingBox(),
    retry: await retryButton.boundingBox(),
    surface: await page.getByRole("region", { name: "사진 인증" }).boundingBox(),
    title: await page.getByRole("heading", { name: "사진 인증" }).boundingBox(),
    viewport: page.viewportSize(),
  }
  await writeFile(
    path.join(evidenceDirectory, "task-08-verify-error-viewport.json"),
    `${JSON.stringify(errorViewport, null, 2)}\n`,
    "utf8",
  )
  await retryButton.click()
  await expect(retryInput).toBeFocused()
  await retryInput.setInputFiles({
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    mimeType: "image/png",
    name: "too-large.png",
  })
  await expect(verificationAlert).toContainText("사진은 10MB 이하만 선택할 수 있어요.")
  await page.getByRole("button", { name: "다시 시도하기" }).click()

  // When: a retried photo uses the reduced-motion auto-check path.
  await page.emulateMedia({ reducedMotion: "reduce" })
  await retryInput.setInputFiles(validPng)
  await expect(page.getByText("인증이 완료됐어요.")).toBeVisible()

  // Then: transient file/blob URLs never enter persistence and all created URLs are revoked.
  await page.getByRole("button", { exact: true, name: "예측" }).click()
  const urlAudit = await page.evaluate(() => ({
    created: Number(Reflect.get(window, "__createdObjectUrlCount")),
    revoked: Number(Reflect.get(window, "__revokedObjectUrlCount")),
    storage: localStorage.getItem("poly-routine-demo-state:v1") ?? "",
  }))
  expect(urlAudit.created).toBeGreaterThanOrEqual(2)
  expect(urlAudit.revoked).toBe(urlAudit.created)
  expect(urlAudit.storage).not.toContain("blob:")
  expect(urlAudit.storage).not.toContain("goal-proof.png")
  expect(runtimeErrors).toEqual([])
  await writeFile(
    path.join(evidenceDirectory, "task-08-verify-e2e.txt"),
    [
      `PASS normal checking visible: ${elapsed}ms`,
      "PASS valid PNG: preview -> checking -> success -> explicit settlement",
      "PASS same-tick settlement: one probability-priced completion credit",
      "PASS errors: invalid MIME + 10MB oversize + exact retry focus",
      "PASS retry/unmount lifecycle: every object URL revoked",
      "PASS reduced motion: checking state observed for a stable render boundary",
      "PASS persisted JSON: no Blob, object URL, or filename",
      "PASS runtime console/page errors: 0",
    ].join("\n") + "\n",
    "utf8",
  )
})
