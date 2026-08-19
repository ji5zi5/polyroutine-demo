import { mkdir } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "@playwright/test"

const evidenceDirectory = path.resolve(import.meta.dirname, "../../../.omo/evidence")
const viewports = [
  { height: 812, name: "mobile", width: 375 },
  { height: 1024, name: "tablet", width: 768 },
  { height: 900, name: "desktop", width: 1280 },
] as const

for (const viewport of viewports) {
  test(`renders the selected PWA without overflow at ${viewport.name}`, async ({ page }) => {
    // Given
    await page.setViewportSize({ height: viewport.height, width: viewport.width })

    // When
    await page.goto("/")

    // Then
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("오늘 할 한 가지를 분명하게")
    const widths = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    expect(widths.document).toBeLessThanOrEqual(widths.viewport)
    await mkdir(evidenceDirectory, { recursive: true })
    await page.screenshot({
      fullPage: true,
      path: path.join(evidenceDirectory, `task-2-web-${viewport.name}.png`),
    })
  })
}

test("serves an installable PWA manifest", async ({ request }) => {
  // Given
  const manifestUrl = "/manifest.webmanifest"

  // When
  const response = await request.get(manifestUrl)

  // Then
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ display: "standalone", name: "폴리루틴" })
})

test("keeps React inspection tools out of the production document", async ({ page }) => {
  // Given / When
  await page.goto("/")

  // Then
  await expect(page.locator(`script[src*="react-grab"], script[src*="react-scan"]`)).toHaveCount(0)
})
