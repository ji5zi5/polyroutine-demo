import { describe, expect, it } from "vitest"
import { normalizePlaywrightArguments } from "../../scripts/run-e2e-arguments.mjs"

describe("demo E2E command argument normalization", () => {
  it("drops pnpm's leading separator before forwarding the requested Playwright config", () => {
    // Given: pnpm includes its script/options separator in the child argv.
    const input = ["--", "--config=playwright.demo.config.ts"]

    // When: the wrapper prepares arguments for Playwright.
    const result = normalizePlaywrightArguments(input)

    // Then: Playwright sees the demo config as an option, not as text after an end marker.
    expect(result).toEqual(["--config=playwright.demo.config.ts"])
  })

  it("keeps the wrapper's named filter mapping deterministic", () => {
    // Given: the wrapper's supported named filter and another Playwright option.
    const input = ["--filter", "market flow", "--trace=on"]

    // When: the wrapper prepares arguments for Playwright.
    const result = normalizePlaywrightArguments(input)

    // Then: only the named filter is translated to Playwright's grep option.
    expect(result).toEqual(["--grep", "market flow", "--trace=on"])
  })
})
