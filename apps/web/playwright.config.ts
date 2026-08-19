import { defineConfig } from "@playwright/test"

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: "line",
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "corepack pnpm start --port 3100",
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 120_000,
    url: "http://127.0.0.1:3100",
  },
  workers: 1,
})
