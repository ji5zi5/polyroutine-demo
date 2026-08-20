import { expect, test } from "@playwright/test"
import { openEvidenceScenario, prepareGuidedPhoto, readEvidenceContract } from "./support/evidence"
import {
  assertNoCriticalAxeViolations,
  captureInteractionFrame,
  captureResponsiveState,
  writeActionLog,
} from "./support/visual"

test("evidence-capture uploads one guided photo and shows only its pending receipt", async ({
  page,
  request,
}) => {
  // Given
  const scenario = await openEvidenceScenario(page, request, "task9-guided-upload@example.test")
  await prepareGuidedPhoto(page)
  await captureResponsiveState(page, "evidence-capture-ready")
  await assertNoCriticalAxeViolations(page, "evidence-capture-ready")

  // When
  await page.getByRole("button", { name: "사진 제출하기" }).click()

  // Then
  await expect(page.getByRole("heading", { name: "사진을 접수했어요" })).toBeVisible()
  await expect(page.getByText("완료 시간은 약속하지 않아요", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "검토 상태 확인하기" })).toBeVisible()
  await expect(page.getByRole("link", { name: "금지 이미지·신고·보존 정책" })).toBeVisible()
  await expect(page.getByRole("progressbar")).toHaveCount(0)
  const contract = await readEvidenceContract(request, scenario.goalId)
  expect(contract).toMatchObject({
    evidence: [{ attempt_number: 1, content_type: "image/png", state: "pending" }],
    objectCount: 1,
  })
  await captureResponsiveState(page, "evidence-pending")
  await assertNoCriticalAxeViolations(page, "evidence-pending")
  await writeActionLog("guided-evidence-pending", [
    {
      action: "consent to one bounded operator review",
      input: "keyboard",
      outcome: "server challenge became available",
      sequence: 1,
    },
    {
      action: "select one local guided photo",
      input: "file",
      outcome: "device-local preview remained visible before submission",
      sequence: 2,
    },
    {
      action: "upload guided bytes",
      input: "button",
      outcome: "one quarantine object and one pending receipt",
      sequence: 3,
    },
  ])
})

test("evidence-capture reports denied camera permission and keeps the file fallback", async ({
  page,
  request,
}) => {
  // Given
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          Promise.reject(new DOMException("camera permission denied", "NotAllowedError")),
      },
    })
  })
  const scenario = await openEvidenceScenario(page, request, "task9-camera-denied@example.test")
  await page.getByLabel("사진 제출과 운영자 검토에 동의해요").check()
  await page.getByRole("button", { name: "10분 코드 받기" }).click()

  // When
  await page.getByRole("button", { name: "카메라 열기" }).click()

  // Then
  await expect(page.getByRole("alert").filter({ hasText: "카메라 권한이 없어요" })).toBeVisible()
  await expect(page.getByLabel("학습 노트 사진 선택")).toBeEnabled()
  await expect(page.getByText("사진 선택으로 계속할 수 있어요", { exact: false })).toBeVisible()
  expect(await readEvidenceContract(request, scenario.goalId)).toMatchObject({
    evidence: [],
    objectCount: 0,
  })
  await captureInteractionFrame(page, "camera-denied-file-fallback")
})

test("evidence-capture retries a dropped upload response with one idempotent receipt", async ({
  page,
  request,
}) => {
  // Given
  const scenario = await openEvidenceScenario(page, request, "task9-network-abort@example.test")
  await prepareGuidedPhoto(page)
  let objectUploadCount = 0
  page.on("request", (browserRequest) => {
    if (new URL(browserRequest.url()).pathname === "/__e2e/object-upload") {
      objectUploadCount += 1
    }
  })
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
  await expect(page.getByRole("button", { name: "접수 여부 다시 확인하기" })).toBeVisible()
  expect(await readEvidenceContract(request, scenario.goalId)).toMatchObject({
    evidence: [{ attempt_number: 1, state: "pending" }],
    objectCount: 1,
  })
  await page.unrouteAll({ behavior: "wait" })

  // When
  await page.getByRole("button", { name: "접수 여부 다시 확인하기" }).click()

  // Then
  await expect(page.getByRole("heading", { name: "사진을 접수했어요" })).toBeVisible()
  expect(await readEvidenceContract(request, scenario.goalId)).toMatchObject({
    evidence: [{ attempt_number: 1, state: "pending" }],
    objectCount: 1,
  })
  expect(objectUploadCount).toBe(1)
})
