import { expect, test } from "@playwright/test"
import { openEvidenceScenario, prepareGuidedPhoto, readEvidenceContract } from "./support/evidence"

test("evidence-capture uses presign, measured object upload, and completion before pending", async ({
  page,
  request,
}) => {
  // Given
  const scenario = await openEvidenceScenario(page, request, "task9-upload-contract@example.test")
  await prepareGuidedPhoto(page)
  const requestStages: string[] = []
  let releaseCompletion = (): void => undefined
  const completionGate = new Promise<void>((resolve) => {
    releaseCompletion = resolve
  })
  await page.route(/\/v1\/goals\/[0-9a-f-]+\/evidence\/complete$/, async (route) => {
    await completionGate
    await route.continue()
  })
  page.on("request", (browserRequest) => {
    const url = new URL(browserRequest.url())
    if (url.pathname.endsWith("/evidence/presign")) requestStages.push("presign")
    if (url.pathname === "/__e2e/object-upload") requestStages.push("upload")
    if (url.pathname.endsWith("/evidence/complete")) requestStages.push("complete")
    if (
      browserRequest.method() === "POST" &&
      /\/v1\/goals\/[0-9a-f-]+\/evidence$/.test(url.pathname)
    ) {
      requestStages.push("direct")
    }
  })

  // When
  const completionRequested = page.waitForRequest(/\/v1\/goals\/[0-9a-f-]+\/evidence\/complete$/)
  await page.getByRole("button", { name: "사진 제출하기" }).click()
  await completionRequested

  // Then
  const progress = page.getByRole("progressbar", { name: "사진 바이트 전송률" })
  try {
    await expect(progress).toBeVisible()
    await expect(progress).toHaveAttribute("value", String(68))
    await expect(page.getByText("측정된 전송 100%")).toBeVisible()
  } finally {
    releaseCompletion()
  }
  await expect(page.getByRole("heading", { name: "사진을 접수했어요" })).toBeVisible()
  expect(requestStages).toEqual(["presign", "upload", "complete"])
  await expect(page.getByRole("progressbar")).toHaveCount(0)
  expect(await readEvidenceContract(request, scenario.goalId)).toMatchObject({
    evidence: [{ attempt_number: 1, content_type: "image/png", state: "pending" }],
    objectCount: 1,
    pendingObjectCount: 0,
  })
})

test("evidence-capture rejects malformed uploaded bytes and removes the staged object", async ({
  page,
  request,
}) => {
  // Given
  const scenario = await openEvidenceScenario(page, request, "task9-malformed-upload@example.test")
  await page.getByLabel("사진 제출과 운영자 검토에 동의해요").check()
  await page.getByRole("button", { name: "10분 코드 받기" }).click()
  await page.getByLabel("학습 노트 사진 선택").setInputFiles({
    buffer: Buffer.from("MZ executable"),
    mimeType: "image/png",
    name: "malformed-note.png",
  })

  // When
  await page.getByRole("button", { name: "사진 제출하기" }).click()

  // Then
  await expect(
    page.getByRole("alert").filter({ hasText: "사진을 접수하지 않았어요" }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "접수 여부 다시 확인하기" })).toHaveCount(0)
  await expect(page.getByRole("progressbar")).toHaveCount(0)
  expect(await readEvidenceContract(request, scenario.goalId)).toMatchObject({
    evidence: [],
    objectCount: 0,
    pendingObjectCount: 0,
  })
})

test("evidence-capture reconciles a dropped completion response after reconnect", async ({
  context,
  page,
  request,
}) => {
  // Given
  const scenario = await openEvidenceScenario(page, request, "task9-reconnect@example.test")
  await prepareGuidedPhoto(page)
  let responseDropped = false
  await page.route(/\/v1\/goals\/[0-9a-f-]+\/evidence\/complete$/, async (route) => {
    if (!responseDropped) {
      responseDropped = true
      const delivered = await route.fetch()
      expect(delivered.status()).toBe(202)
      await route.abort("internetdisconnected")
      return
    }
    await route.continue()
  })
  await page.getByRole("button", { name: "사진 제출하기" }).click()
  await expect(
    page.getByRole("alert").filter({ hasText: "서버 영수증을 확인하지 못했어요" }),
  ).toBeVisible()
  await page.unrouteAll({ behavior: "wait" })
  await context.setOffline(true)
  await expect(page.getByRole("status").filter({ hasText: "오프라인입니다" })).toBeVisible()

  // When
  await context.setOffline(false)

  // Then
  await expect(page.getByRole("heading", { name: "사진을 접수했어요" })).toBeVisible()
  await expect(page.getByRole("progressbar")).toHaveCount(0)
  expect(await readEvidenceContract(request, scenario.goalId)).toMatchObject({
    evidence: [{ attempt_number: 1, state: "pending" }],
    objectCount: 1,
    pendingObjectCount: 0,
  })
})
