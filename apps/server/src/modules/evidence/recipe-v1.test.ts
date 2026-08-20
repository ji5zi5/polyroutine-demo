import { evidenceRecipeV1 } from "@polyroutine/contracts"
import { describe, expect, it } from "vitest"

describe("recipe-v1 contract", () => {
  it("selects the sole versioned guided recipe with three verdict fixtures", () => {
    // Given
    const expectedFixtureVerdicts = ["positive", "negative", "inconclusive"]

    // When
    const recipe = evidenceRecipeV1

    // Then
    expect(recipe).toMatchObject({
      capture: { challengeExpiresInSeconds: 600, kind: "server_guided_challenge" },
      id: "study_note_photo_v1",
      noteLineMinimum: 3,
      version: 1,
    })
    expect(recipe.fixtures.map(({ verdict }) => verdict)).toEqual(expectedFixtureVerdicts)
  })
})
