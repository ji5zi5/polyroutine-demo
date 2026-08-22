import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const appRoot = path.resolve(import.meta.dirname, "../..")

function stylesheet(relativePath: string): string {
  return readFileSync(path.join(appRoot, relativePath), "utf8")
}

describe("task 12 accessible accent contract", () => {
  it("keeps design-system resting and interaction colors in their documented roles", () => {
    // Given: touched mobile surfaces contain compact brand text and primary actions.
    const tokens = stylesheet("app/tokens.css")
    const compactSurfaces = [
      stylesheet("app/demo-app.css"),
      stylesheet("app/surfaces.css"),
      stylesheet("components/demo-goal-analysis/goal-analysis-panel.module.css"),
      stylesheet("components/demo-market/portfolio-history.module.css"),
      stylesheet("components/demo-my/demo-my.module.css"),
      stylesheet("components/demo-points/demo-points.module.css"),
      stylesheet("components/demo-shop/demo-shop.module.css"),
    ].join("\n")

    // When: the semantic CSS contract is inspected.
    const restingHoverMisuse = compactSurfaces.match(/color: var\(--accent-hover\)/gu) ?? []

    // Then: blue-500 remains the resting CTA, while blue-600 is interaction-only.
    expect(tokens).not.toContain("--accent-primary-strong:")
    expect(tokens).not.toContain("--accent-primary-strong-hover:")
    expect(tokens).not.toContain("--text-brand-strong:")
    expect(tokens).toContain("--text-primary-action: 1.1875rem")
    expect(restingHoverMisuse).toEqual([])
    expect(compactSurfaces).toContain("background: var(--accent-primary)")
    expect(compactSurfaces).toContain("background: var(--accent-hover)")
    expect(compactSurfaces).not.toContain("color: var(--text-brand-strong)")
    expect(compactSurfaces).toContain("font-size: var(--text-primary-action)")
  })
})
