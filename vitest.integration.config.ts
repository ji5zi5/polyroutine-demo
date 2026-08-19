import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    hookTimeout: 120_000,
    include: ["apps/server/test/**/*.integration.test.ts"],
    testTimeout: 30_000,
  },
})
