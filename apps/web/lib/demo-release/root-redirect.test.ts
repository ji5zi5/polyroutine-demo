import { describe, expect, it } from "vitest"
import nextConfig from "../../next.config.mjs"

describe("local production demo entry", () => {
  it("redirects the root route to the mobile demo", async () => {
    // Given: the same Next configuration used by production start.
    // When: its route redirects are resolved.
    const redirects = await nextConfig.redirects?.()

    // Then: root navigation enters the demo without relying on Netlify-only rules.
    expect(redirects).toContainEqual({
      destination: "/demo",
      permanent: false,
      source: "/",
    })
  })
})
