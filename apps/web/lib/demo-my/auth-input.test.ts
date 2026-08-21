import { describe, expect, it } from "vitest"
import { nicknameDisplayLines, parseAuthInput, parseNicknameInput } from "./auth-input"

describe("parseAuthInput", () => {
  it("accepts a Korean nickname after trimming during signup", () => {
    // Given
    const input = {
      email: "routine@example.com",
      mode: "signup" as const,
      nickname: "  루틴지킴이  ",
      password: "demo-password",
    }

    // When
    const result = parseAuthInput(input)

    // Then
    expect(result).toEqual({
      kind: "valid",
      value: {
        email: "routine@example.com",
        mode: "signup",
        nickname: "루틴지킴이",
      },
    })
  })

  it("returns field-specific feedback when login fields are invalid", () => {
    // Given
    const input = { email: "not-an-email", mode: "login" as const, password: "" }

    // When
    const result = parseAuthInput(input)

    // Then
    expect(result).toEqual({
      errors: {
        email: "이메일 형식을 확인해 주세요.",
        password: "비밀번호를 입력해 주세요.",
      },
      kind: "invalid",
    })
  })

  it("rejects an empty signup nickname without rejecting Korean text", () => {
    // Given
    const input = {
      email: "routine@example.com",
      mode: "signup" as const,
      nickname: "   ",
      password: "demo-password",
    }

    // When
    const result = parseAuthInput(input)

    // Then
    expect(result).toEqual({
      errors: { nickname: "닉네임을 입력해 주세요." },
      kind: "invalid",
    })
  })
})

describe("parseNicknameInput", () => {
  it("balances an unspaced long Korean nickname without splitting the middle phrase", () => {
    // Given
    const nickname = "매일목표끝까지해내는루틴지킴이"

    // When
    const lines = nicknameDisplayLines(nickname)

    // Then
    expect(lines).toEqual(["매일목표끝까지", "해내는루틴지킴이"])
  })

  it("returns trimmed Korean text for profile editing", () => {
    // Given
    const nickname = "  매일해내기  "

    // When
    const result = parseNicknameInput(nickname)

    // Then
    expect(result).toEqual({ kind: "valid", nickname: "매일해내기" })
  })

  it("returns actionable feedback for an overlong nickname", () => {
    // Given
    const nickname = "가".repeat(17)

    // When
    const result = parseNicknameInput(nickname)

    // Then
    expect(result).toEqual({
      error: "닉네임은 16자까지 입력할 수 있어요.",
      kind: "invalid",
    })
  })
})
