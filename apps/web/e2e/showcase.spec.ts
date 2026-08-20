import { mkdir } from "node:fs/promises"
import path from "node:path"
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const evidenceDirectory = path.resolve(
  import.meta.dirname,
  "../../../.omo/evidence/task-7/showcase",
)
const viewports = [
  { height: 800, name: "mobile", width: 360 },
  { height: 1024, name: "tablet", width: 768 },
  { height: 900, name: "desktop", width: 1280 },
] as const

for (const viewport of viewports) {
  test(`primitive showcase passes at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto("/showcase")
    await expect(page.getByRole("heading", { level: 1, name: "상태와 행동의 언어" })).toBeVisible()
    await page.getByRole("button", { name: "저장하기" }).hover()
    await page.getByLabel("학습 노트 줄 수").focus()
    const dimensions = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
    const axe = await new AxeBuilder({ page }).analyze()
    expect(axe.violations).toEqual([])
    await mkdir(evidenceDirectory, { recursive: true })
    await page.screenshot({
      fullPage: true,
      path: path.join(evidenceDirectory, `${viewport.name}.png`),
    })
  })
}

test("primitive showcase preserves controls with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/showcase")
  await page.getByRole("button", { name: "YES - 해낼 것 같아요" }).focus()
  await expect(page.getByRole("button", { name: "YES - 해낼 것 같아요" })).toBeFocused()
})
