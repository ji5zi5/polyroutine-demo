import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { type Browser, chromium, type Page } from "@playwright/test"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

let browser: Browser | undefined
let origin = ""
let serverProcess: ChildProcessWithoutNullStreams | undefined

async function startHarness(): Promise<{
  readonly origin: string
  readonly process: ChildProcessWithoutNullStreams
}> {
  const workspaceRoot = path.resolve(import.meta.dirname, "../../../../../")
  const packageDirectories = await readdir(path.join(workspaceRoot, "node_modules/.pnpm"))
  const viteDirectory = packageDirectories.find((directory) => directory.startsWith("vite@8.2.1_"))
  if (viteDirectory === undefined) throw new TypeError("Installed Vite runtime was not found")
  const viteCli = path.join(
    workspaceRoot,
    "node_modules/.pnpm",
    viteDirectory,
    "node_modules/vite/bin/vite.js",
  )
  const harnessRoot = path.join(import.meta.dirname, "hook-test-harness")
  const childProcess = spawn(
    process.execPath,
    [viteCli, harnessRoot, "--host", "127.0.0.1", "--port", "0"],
    {
      cwd: workspaceRoot,
      stdio: "pipe",
    },
  )

  const harnessOrigin = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new TypeError("Hook harness startup timed out")),
      10_000,
    )
    const inspect = (chunk: Buffer): void => {
      const match = chunk.toString().match(/Local:\s+http:\/\/127\.0\.0\.1:(\d+)/)
      const port = match?.[1]
      if (port === undefined) return
      clearTimeout(timeout)
      resolve(`http://127.0.0.1:${port}`)
    }
    childProcess.stdout.on("data", inspect)
    childProcess.stderr.on("data", inspect)
    childProcess.once("exit", (code) => reject(new TypeError(`Hook harness exited early: ${code}`)))
  })
  return { origin: harnessOrigin, process: childProcess }
}

async function openHarnessPage(): Promise<Page> {
  if (browser === undefined) throw new TypeError("Browser is not initialized")
  const page = await browser.newPage()
  await page.goto(origin)
  return page
}

beforeAll(async () => {
  const harness = await startHarness()
  origin = harness.origin
  serverProcess = harness.process
  browser = await chromium.launch({ channel: "chrome", headless: true })
}, 20_000)

afterAll(async () => {
  await browser?.close()
  const processToStop = serverProcess
  if (processToStop !== undefined && processToStop.exitCode === null) {
    const exited = new Promise<void>((resolve) => processToStop.once("exit", () => resolve()))
    processToStop.kill("SIGTERM")
    await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new TypeError("Hook harness cleanup timed out")), 3_000),
      ),
    ])
  }
}, 20_000)

describe("useGoalAnalysis lifecycle cancellation", () => {
  it("aborts reset and ignores the retained late completion", async () => {
    // Given
    const page = await openHarnessPage()
    await page.getByRole("button", { name: "분석", exact: true }).click()
    await expect.poll(() => page.getByTestId("state").textContent()).toBe("loading")

    // When
    await page.getByRole("button", { name: "재설정", exact: true }).click()
    await page.getByRole("button", { name: "늦은 응답 완료", exact: true }).click()

    // Then
    await expect.poll(() => page.getByTestId("signal").textContent()).toBe("true")
    await expect.poll(() => page.getByTestId("state").textContent()).toBe("idle")
    await page.close()
  }, 15_000)

  it("aborts unmount and cannot restore state from the retained late completion", async () => {
    // Given
    const page = await openHarnessPage()
    await page.getByRole("button", { name: "분석", exact: true }).click()
    await expect.poll(() => page.getByTestId("state").textContent()).toBe("loading")

    // When
    await page.getByRole("button", { name: "언마운트", exact: true }).click()
    await page.getByRole("button", { name: "늦은 응답 완료", exact: true }).click()

    // Then
    await expect.poll(() => page.getByTestId("signal").textContent()).toBe("true")
    await expect.poll(() => page.getByTestId("probe").count()).toBe(0)
    await page.close()
  }, 15_000)

  it("labels the enabled success action as another analysis", async () => {
    // Given
    const page = await openHarnessPage()

    // When
    await page.getByRole("button", { name: "성공 확률 분석하기", exact: true }).click()

    // Then
    await expect.poll(() => page.getByText("73%", { exact: true }).count()).toBe(1)
    await expect
      .poll(() => page.getByRole("button", { name: "다시 분석하기", exact: true }).isEnabled())
      .toBe(true)
    await page.close()
  }, 15_000)
})
