import path from "node:path"
import { defineConfig } from "@playwright/test"

const evidenceTask = process.env["POLYROUTINE_EVIDENCE_TASK"] ?? "task-7"

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  globalSetup: "./tests/e2e/support/global-setup.ts",
  outputDir: path.resolve(import.meta.dirname, `../../.omo/evidence/${evidenceTask}/playwright`),
  reporter: "line",
  testDir: ".",
  testMatch: ["e2e/**/*.spec.ts", "tests/e2e/**/*.spec.ts"],
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: "chrome",
    trace: "on",
  },
  webServer: {
    command: "corepack pnpm start --port 3100",
    env: {
      POLYROUTINE_API_ORIGIN: "http://127.0.0.1:3101",
      POLYROUTINE_PUBLIC_ORIGIN: "http://127.0.0.1:3100",
    },
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 120_000,
    url: "http://127.0.0.1:3100",
  },
  workers: 1,
})
