import { writeFileSync } from "node:fs"
import path from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { DEMO_STATE_STORAGE_KEY, demoPersistenceSchema } from "../../lib/demo-state/persistence"

const EVIDENCE_DIR = path.resolve(
  import.meta.dirname,
  "../../../../.omo/evidence/polyroutine-demo-next-iteration",
)

async function loginDemo(page: Page): Promise<void> {
  await page.getByLabel("이메일").fill("demo@polyroutine.app")
  await page.getByLabel("비밀번호").fill("routine123")
  await page.getByRole("button", { name: "로그인", exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    const marker = "poly-routine-e2e-storage-cleared"
    if (sessionStorage.getItem(marker) !== null) return
    localStorage.removeItem(key)
    sessionStorage.setItem(marker, "true")
  }, DEMO_STATE_STORAGE_KEY)
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "randomUUID", {
      configurable: true,
      value: () => {
        const next = Number(sessionStorage.getItem("poly-routine-e2e-id") ?? "0") + 1
        sessionStorage.setItem("poly-routine-e2e-id", String(next))
        return `qa-${next}`
      },
    })
  })
  await page.setViewportSize({ height: 812, width: 375 })
})

async function storedSnapshot(page: Page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), DEMO_STATE_STORAGE_KEY)
  if (raw === null) throw new TypeError("persisted demo snapshot is missing")
  return demoPersistenceSchema.parse(JSON.parse(raw))
}

async function choosePrediction(page: Page, choice: "no" | "yes"): Promise<string> {
  const card = page.locator(".predictionCard")
  const cardId = await card.getAttribute("data-goal-id")
  if (cardId === null) throw new TypeError("prediction card id is missing")
  await card.focus()
  await card.press(choice === "yes" ? "ArrowLeft" : "ArrowRight")
  await expect(card).not.toHaveAttribute("data-goal-id", cardId)
  return cardId
}

test("restores the device profile before rendering after refresh", async ({ page }) => {
  await page.goto("/demo")
  await page.getByRole("button", { name: "회원가입", exact: true }).click()
  await page.getByLabel("닉네임").fill("새벽 러너")
  await page.getByLabel("이메일").fill("runner@polyroutine.app")
  await page.getByLabel("비밀번호").fill("routine123")
  await page.locator('.demoLoginForm button[type="submit"]').click()

  await page.reload()

  await expect(page.getByRole("heading", { name: "가능할지 골라요" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "오늘도 가볍게 시작해요" })).toHaveCount(0)
  await page.getByRole("button", { name: "MY", exact: true }).click()
  await expect(page.getByRole("heading", { name: "새벽 러너" })).toBeVisible()
  await expect(page.getByText("runner@polyroutine.app", { exact: true })).toBeVisible()
})

test("opens a fresh market round immediately after settlement", async ({ page }) => {
  await page.goto("/demo")
  await loginDemo(page)
  const card = page.locator(".predictionCard")
  await card.focus()
  await card.press("ArrowLeft")
  await expect(page.getByText("51,100P", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "포인트", exact: true }).click()
  await page.getByRole("button", { name: "예측 결과 정산하기" }).click()
  await page.getByRole("button", { name: "예측", exact: true }).click()
  const balanceLabel = page.locator(".demoStepLabel")
  await expect(balanceLabel).toHaveText(/^\d{1,3}(,\d{3})*P$/)
  const before = Number((await balanceLabel.textContent())?.replace(/[,P]/g, ""))

  await card.focus()
  await card.press("ArrowLeft")

  await expect(balanceLabel).toHaveText(`${(before - 100).toLocaleString("ko-KR")}P`)
})

test("renders untrusted profile copy as text", async ({ page }) => {
  await page.goto("/demo")
  await page.getByRole("button", { name: "회원가입", exact: true }).click()
  await page.getByLabel("닉네임").fill("<img src=x>")
  await page.getByLabel("이메일").fill("safe@polyroutine.app")
  await page.getByLabel("비밀번호").fill("routine123")
  await page.locator('.demoLoginForm button[type="submit"]').click()
  await page.getByRole("button", { name: "MY", exact: true }).click()

  await expect(page.getByRole("heading", { name: "<img src=x>" })).toBeVisible()
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
})

test("persists approved device data and resets only the demo key", async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  await page.goto("/demo")
  await page.evaluate(() => localStorage.setItem("unrelated-sentinel", "keep-me"))
  await page.getByRole("button", { name: "회원가입", exact: true }).click()
  await page.getByLabel("닉네임").fill("루틴 기록자")
  await page.getByLabel("이메일").fill("keeper@polyroutine.app")
  await page.getByLabel("비밀번호").fill("never-persist-this")
  await page.locator('.demoLoginForm button[type="submit"]').click()
  await choosePrediction(page, "yes")
  await page.getByRole("button", { name: "내 목표", exact: true }).click()
  await page.getByLabel("오늘의 목표").fill("아침 20분 달리기")
  await page.getByRole("button", { name: "목표 추가" }).click()
  await page.getByLabel("오늘의 목표").fill("저장하면 안 되는 작성 중 문장")
  await page.getByRole("button", { name: "포인트", exact: true }).click()
  await page.getByRole("button", { name: "출석체크" }).click()
  await page.getByRole("button", { name: "오늘 출석하기 · +200P" }).click()
  await page.getByRole("button", { name: "GS25 모바일 상품권 1천원권 50,000P로 구매" }).click()
  await page.getByRole("button", { name: "구매하기", exact: true }).click()

  const beforeReload = await storedSnapshot(page)
  const serialized = JSON.stringify(beforeReload)
  expect(serialized).not.toContain("never-persist-this")
  expect(serialized).not.toContain("저장하면 안 되는 작성 중 문장")
  expect(beforeReload.state.balance).toBe(1_300)
  await page.reload()
  await expect(page.getByRole("heading", { name: "가능할지 골라요" })).toBeVisible()
  await page.getByRole("button", { name: "MY", exact: true }).click()
  await expect(page.getByRole("heading", { name: "루틴 기록자" })).toBeVisible()
  await expect(page.getByText("keeper@polyroutine.app", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "로그아웃", exact: true }).click()
  await loginDemo(page)
  await page.getByRole("button", { name: "MY", exact: true }).click()
  await expect(page.getByRole("heading", { name: "루틴 기록자" })).toBeVisible()
  await expect(page.getByText("keeper@polyroutine.app", { exact: true })).toBeVisible()

  const resetButton = page.getByRole("button", { name: "데이터 초기화", exact: true })
  await resetButton.click()
  await page.getByRole("button", { name: "취소", exact: true }).click()
  await expect(resetButton).toBeFocused()
  await resetButton.click()
  await page.getByRole("button", { name: "초기화하기", exact: true }).click()
  await expect(page.getByRole("heading", { name: "오늘도 가볍게 시작해요" })).toBeVisible()
  await expect(page.getByLabel("이메일")).toBeFocused()
  expect(await page.evaluate((key) => localStorage.getItem(key), DEMO_STATE_STORAGE_KEY)).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem("unrelated-sentinel"))).toBe("keep-me")

  await page.evaluate((key) => localStorage.setItem(key, "{broken"), DEMO_STATE_STORAGE_KEY)
  await page.reload()
  await expect(page.getByRole("heading", { name: "오늘도 가볍게 시작해요" })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem("unrelated-sentinel"))).toBe("keep-me")
  await page.evaluate(({ key }) => localStorage.setItem(key, JSON.stringify({ version: 999 })), {
    key: DEMO_STATE_STORAGE_KEY,
  })
  await page.reload()
  await expect(page.getByRole("heading", { name: "오늘도 가볍게 시작해요" })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem("unrelated-sentinel"))).toBe("keep-me")
  expect(runtimeErrors).toEqual([])

  writeFileSync(
    path.join(EVIDENCE_DIR, "task-04-persistence.json"),
    JSON.stringify(
      {
        approvedStateBeforeReset: beforeReload,
        draftExcluded: !serialized.includes("저장하면 안 되는 작성 중 문장"),
        passwordExcluded: !serialized.includes("never-persist-this"),
        sentinelPreserved: true,
        runtimeErrors,
      },
      null,
      2,
    ),
  )
})

test("archives a mixed repeated-card round and keeps betting", async ({ page }) => {
  test.setTimeout(60_000)
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  await page.goto("/demo")
  await loginDemo(page)

  const cardIds = [await choosePrediction(page, "yes")]
  await page.reload()
  cardIds.push(await choosePrediction(page, "no"))
  await page.getByRole("button", { name: "건너뛰기", exact: true }).click()
  for (const choice of ["yes", "no", "yes", "no"] as const) {
    cardIds.push(await choosePrediction(page, choice))
  }
  const pending = await storedSnapshot(page)
  expect(pending.state.positions).toHaveLength(6)
  expect(cardIds.filter((cardId) => cardId === cardIds[0])).toHaveLength(2)
  expect(pending.state.balance).toBe(50_600)
  const firstRoundId = pending.state.round.id

  await page.getByRole("button", { name: "포인트", exact: true }).click()
  const settleButton = page.getByRole("button", { name: "예측 결과 정산하기" })
  await settleButton.evaluate((button) => {
    button.click()
    button.click()
  })
  await expect(page.getByText(/^적중 정산 \+\d+P$/)).toBeVisible()
  await page.getByRole("button", { name: "MY", exact: true }).click()
  await page.getByText("내 예측", { exact: true }).click()
  await expect(page.locator("[data-round-id]")).toHaveCount(1)
  const settled = await storedSnapshot(page)
  expect(settled.state.marketHistory).toHaveLength(6)
  expect(settled.state.settledRoundIds).toEqual([firstRoundId])
  expect(settled.state.round.id).not.toBe(firstRoundId)
  const independentlyReconciled = settled.state.ledger.reduce(
    (balance, event) =>
      event.direction === "credit" ? balance + event.amount : balance - event.amount,
    settled.state.initialBalance,
  )
  expect(independentlyReconciled).toBe(settled.state.balance)
  await page.screenshot({
    fullPage: true,
    path: path.join(EVIDENCE_DIR, "task-07-settlement-375.png"),
  })

  await page.getByRole("button", { name: "예측", exact: true }).click()
  const balanceBeforeNextRound = settled.state.balance
  await choosePrediction(page, "yes")
  const nextRound = await storedSnapshot(page)
  expect(nextRound.state.positions).toHaveLength(1)
  expect(nextRound.state.balance).toBe(balanceBeforeNextRound - 100)
  await page.reload()
  await expect(page.locator(".demoStepLabel")).toHaveText(
    `${nextRound.state.balance.toLocaleString("ko-KR")}P`,
  )

  await page.getByRole("button", { name: "포인트", exact: true }).click()
  await page.getByRole("button", { name: "GS25 모바일 상품권 1천원권 50,000P로 구매" }).click()
  await page.getByRole("button", { name: "구매하기", exact: true }).click()
  await page.getByRole("button", { name: "예측", exact: true }).click()
  const afterPurchase = await storedSnapshot(page)
  const affordablePositions = Math.floor(afterPurchase.state.balance / 100)
  for (let index = 0; index < affordablePositions; index += 1) {
    await choosePrediction(page, index % 2 === 0 ? "yes" : "no")
  }
  const beforeInsufficient = await storedSnapshot(page)
  expect(beforeInsufficient.state.balance).toBeLessThan(100)
  const blockedCard = page.locator(".predictionCard")
  const blockedCardId = await blockedCard.getAttribute("data-goal-id")
  if (blockedCardId === null) throw new TypeError("blocked prediction card id is missing")

  await blockedCard.focus()
  await blockedCard.press("ArrowLeft")

  const held = beforeInsufficient.state.balance
  await expect(
    page.getByText(`100P 필요 · 보유 ${held}P · ${100 - held}P 부족`, { exact: true }),
  ).toBeVisible()
  await expect(blockedCard).toHaveAttribute("data-goal-id", blockedCardId)
  const afterInsufficient = await storedSnapshot(page)
  expect(afterInsufficient.state).toEqual(beforeInsufficient.state)
  await page.screenshot({
    fullPage: true,
    path: path.join(EVIDENCE_DIR, "task-07-insufficient-375.png"),
  })
  expect(runtimeErrors).toEqual([])

  writeFileSync(
    path.join(EVIDENCE_DIR, "task-07-market-rounds.json"),
    JSON.stringify(
      {
        duplicateCardId: cardIds[0],
        firstRoundId,
        insufficient: {
          after: {
            balance: afterInsufficient.state.balance,
            ledgerCount: afterInsufficient.state.ledger.length,
            positionCount: afterInsufficient.state.positions.length,
          },
          before: {
            balance: beforeInsufficient.state.balance,
            ledgerCount: beforeInsufficient.state.ledger.length,
            positionCount: beforeInsufficient.state.positions.length,
          },
          blockedCardId,
          held,
          required: 100,
          shortfall: 100 - held,
        },
        independentlyReconciled,
        ledger: settled.state.ledger,
        nextRoundId: nextRound.state.round.id,
        pendingAfterNewRound: nextRound.state.positions,
        settledHistory: settled.state.marketHistory,
        runtimeErrors,
      },
      null,
      2,
    ),
  )
})
