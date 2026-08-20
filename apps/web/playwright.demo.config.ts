import path from "node:path"
import { defineConfig } from "@playwright/test"

// biome-ignore lint/style/noDefaultExport: Playwright discovers the configuration through its default export.
export default defineConfig({
  expect: { timeout: 5_000 },
  outputDir: path.resolve(
    import.meta.dirname,
    "../../.omo/evidence/demo/mobile-prototype/playwright",
  ),
  reporter: "line",
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
