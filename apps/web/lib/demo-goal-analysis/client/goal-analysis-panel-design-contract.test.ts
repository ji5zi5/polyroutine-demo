import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

describe("goal analysis panel design contract", () => {
  it("consumes shared semantic color and motion tokens", async () => {
    // Given
    const stylesheetPath = path.resolve(
      import.meta.dirname,
      "../../../components/demo-goal-analysis/goal-analysis-panel.module.css",
    )

    // When
    const stylesheet = await readFile(stylesheetPath, "utf8")

    // Then
    expect(stylesheet).not.toMatch(/oklch|cubic-bezier|\b\d+ms\b/u)
    expect(stylesheet).toContain("var(--accent-primary)")
    expect(stylesheet).toContain("var(--motion-base)")
  })
})
