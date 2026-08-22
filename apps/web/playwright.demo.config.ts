import path from "node:path"
import { defineConfig } from "@playwright/test"

const task13EvidenceDirectory = path.resolve(
  import.meta.dirname,
  "../../.omo/evidence/polyroutine-demo-next-iteration",
)

// biome-ignore lint/style/noDefaultExport: Playwright discovers the configuration through its default export.
export default defineConfig({
  expect: { timeout: 5_000 },
  outputDir: path.join(task13EvidenceDirectory, "task-13-playwright-artifacts"),
  reporter: [
    ["line"],
    ["json", { outputFile: path.join(task13EvidenceDirectory, "task-13-report.raw.json") }],
  ],
  testDir: "./tests/e2e",
  testMatch: "demo*.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: "chrome",
    trace: "on",
  },
  webServer: {
    command: "corepack pnpm start --port 3100",
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3100",
  },
  workers: 1,
})
