import { describe, expect, it } from "vitest"
import { Argon2idPasswordHasher, OpaqueSecretCodec } from "./crypto.js"

describe("accounts cryptography", () => {
  it("hashes passwords with Argon2id and verifies only the original password", async () => {
    // Given
    const hasher = new Argon2idPasswordHasher()

    // When
    const encoded = await hasher.hash("correct horse battery staple")

    // Then
    expect(encoded).toMatch(/^\$argon2id\$/)
    await expect(hasher.verify(encoded, "correct horse battery staple")).resolves.toBe(true)
    await expect(hasher.verify(encoded, "incorrect password")).resolves.toBe(false)
    expect(encoded).not.toContain("correct horse battery staple")
  })

  it("issues opaque secrets whose persisted hash cannot recover the token", () => {
    // Given
    const codec = new OpaqueSecretCodec("test-session-secret-at-least-32-characters")

    // When
    const issued = codec.issue()

    // Then
    expect(issued.value).not.toBe(issued.hash)
    expect(issued.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(codec.matches(issued.value, issued.hash)).toBe(true)
  })
})
