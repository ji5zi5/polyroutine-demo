import { defineConfig } from "vitest/config"

// biome-ignore lint/style/noDefaultExport: Vitest loads configuration through its required default export.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ["lib/**/*.test.ts"],
  },
})
