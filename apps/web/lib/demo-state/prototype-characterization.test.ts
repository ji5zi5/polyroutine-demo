import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const prototypeSource = readFileSync(
  new URL("../../components/prototype-demo.tsx", import.meta.url),
  "utf8",
)

describe("prototype demo points characterization", () => {
  it("starts with 51,200P", () => {
    // Given: the unchanged prototype implementation
    // When: its initial points state is inspected
    const initialPoints = prototypeSource.match(
      /const \[points, setPoints\] = useState\((\d[\d_]*)\)/,
    )?.[1]

    // Then: the established demo balance remains pinned
    expect(initialPoints).toBe("51_200")
  })

  it("credits the gross prediction payout after debiting the stake", () => {
    // Given: the unchanged prototype prediction flow
    // When: its debit, payout, and settlement expressions are inspected
    const usesGrossPayout = [
      "setPoints((current) => current - 100)",
      "Math.ceil(10_000 / selectedPercent)",
      "setPoints((current) => current + payout)",
    ].every((expression) => prototypeSource.includes(expression))

    // Then: the stake is not added to the calculated payout a second time
    expect(usesGrossPayout).toBe(true)
  })
})
