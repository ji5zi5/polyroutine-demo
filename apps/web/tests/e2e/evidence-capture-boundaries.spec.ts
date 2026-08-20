import { expect, test } from "@playwright/test"
import {
  openEvidenceScenario,
  prepareGuidedPhoto,
  readEvidenceContract,
  setEvidenceVerdict,
} from "./support/evidence"
import { setServerTime } from "./support/flows"

test("evidence-capture rejects a server-expired challenge without offering transport retry", async ({
  page,
  request,
}) => {
  // Given
  const scenario = await openEvidenceScenario(page, request, "task9-expired-challenge@example.test")
  await prepareGuidedPhoto(page)
  await setServerTime(request, "2099-08-20T00:10:00.001Z")

  // When
  await page.getByRole("button", { name: "사진을 서버에 제출" }).click()

  // Then
  await expect(
    page.getByRole("alert").filter({ hasText: "10분 코드가 만료되었습니다" }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "새 10분 코드 받기" })).toBeVisible()
  await expect(page.getByRole("button", { name: "같은 업로드 영수증 확인" })).toHaveCount(0)
  expect(await readEvidenceContract(request, scenario.goalId)).toMatchObject({
    evidence: [],
    objectCount: 0,
  })
})

test("evidence-capture reports the server deadline without storing late bytes", async ({
  page,
  request,
}) => {
  // Given
  const scenario = await openEvidenceScenario(page, request, "task9-late-evidence@example.test")
  await prepareGuidedPhoto(page)
  await setServerTime(request, scenario.evidenceDeadlineAt)

  // When
  await page.getByRole("button", { name: "사진을 서버에 제출" }).click()

  // Then
  await expect(
    page.getByRole("alert").filter({ hasText: "증거 제출 마감이 지났습니다" }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "같은 업로드 영수증 확인" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "새 10분 코드 받기" })).toHaveCount(0)
  expect(await readEvidenceContract(request, scenario.goalId)).toMatchObject({
    evidence: [],
    objectCount: 0,
  })
})

test("evidence-capture permits one processing resubmission and stops after attempt two", async ({
  page,
  request,
}) => {
  // Given
  const scenario = await openEvidenceScenario(page, request, "task9-bounded-retry@example.test")
  await prepareGuidedPhoto(page)
  await page.getByRole("button", { name: "사진을 서버에 제출" }).click()
  await expect(page.getByRole("heading", { name: "사진 영수증이 접수되었습니다" })).toBeVisible()
  const firstContract = await readEvidenceContract(request, scenario.goalId)
  const firstReceipt = firstContract.evidence[0]?.receipt_id
  if (firstReceipt === undefined) throw new TypeError("first evidence receipt is missing")
  await setEvidenceVerdict(request, firstReceipt, {
    reasonCode: "image_unreadable",
    state: "inconclusive",
  })

  await page.getByRole("button", { name: "검토 상태 새로고침" }).click()
  await expect(
    page.getByText("흐림·빛 반사·잘림 때문에 안내 항목을 확인하기 어려웠습니다"),
  ).toBeVisible()
  await page.getByRole("button", { name: "새 코드로 다시 제출" }).click()
  await page.getByRole("button", { name: "10분 코드 받기" }).click()
  await page.getByLabel("학습 노트 사진 선택").setInputFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "today-study-note-retry.png",
  })
  await page.getByRole("button", { name: "사진을 서버에 제출" }).click()
  await expect(page.getByRole("heading", { name: "사진 영수증이 접수되었습니다" })).toBeVisible()
  const secondContract = await readEvidenceContract(request, scenario.goalId)
  const secondReceipt = secondContract.evidence[1]?.receipt_id
  if (secondReceipt === undefined) throw new TypeError("second evidence receipt is missing")
  expect(secondContract).toMatchObject({ objectCount: 2 })
  await setEvidenceVerdict(request, secondReceipt, {
    reasonCode: "notes_insufficient",
    state: "rejected",
  })

  // When
  await page.getByRole("button", { name: "검토 상태 새로고침" }).click()

  // Then
  await expect(page.getByText("두 번의 제출 기회를 모두 사용했습니다")).toBeVisible()
  await expect(page.getByRole("button", { name: "새 코드로 다시 제출" })).toHaveCount(0)
})
