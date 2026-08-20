import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import AxeBuilder from "@axe-core/playwright"
import { expect, type Page } from "@playwright/test"

const evidenceTask = process.env["POLYROUTINE_EVIDENCE_TASK"] ?? "task-7"
const evidenceDirectory = path.resolve(
  import.meta.dirname,
  `../../../../../.omo/evidence/${evidenceTask}`,
)
const viewports = [
  { height: 800, name: "mobile", width: 360 },
  { height: 1024, name: "tablet", width: 768 },
  { height: 900, name: "desktop", width: 1280 },
] as const

type ActionLogEntry = {
  readonly action: string
  readonly input: "button" | "camera" | "file" | "keyboard" | "screen-reader" | "server" | "swipe"
  readonly outcome: string
  readonly sequence: number
}

export async function writeActionLog(
  scenario: string,
  actions: readonly ActionLogEntry[],
): Promise<void> {
  const actionDirectory = path.join(evidenceDirectory, "actions")
  await mkdir(actionDirectory, { recursive: true })
  await writeFile(
    path.join(actionDirectory, `${scenario}.json`),
    `${JSON.stringify({ actions, scenario }, null, 2)}\n`,
    "utf8",
  )
}

export async function captureInteractionFrame(page: Page, frame: string): Promise<void> {
  const interactionDirectory = path.join(evidenceDirectory, "interactions")
  await mkdir(interactionDirectory, { recursive: true })
  await page.screenshot({
    path: path.join(interactionDirectory, `${frame}.png`),
  })
}

export async function captureResponsiveState(page: Page, state: string): Promise<void> {
  const screenshotDirectory = path.join(evidenceDirectory, "screenshots")
  await mkdir(screenshotDirectory, { recursive: true })
  for (const viewport of viewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    const dimensions = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
    await page.screenshot({
      fullPage: true,
      path: path.join(screenshotDirectory, `${state}-${viewport.name}.png`),
    })
  }
}

export async function assertNoCriticalAxeViolations(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze()
  const critical = results.violations.filter(({ impact }) => impact === "critical")
  await mkdir(path.join(evidenceDirectory, "axe"), { recursive: true })
  await writeFile(
    path.join(evidenceDirectory, "axe", `${state}.json`),
    `${JSON.stringify({ critical, violations: results.violations }, null, 2)}\n`,
    "utf8",
  )
  expect(critical).toEqual([])
  expect(results.violations).toEqual([])
}
