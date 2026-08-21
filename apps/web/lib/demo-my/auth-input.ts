import { z } from "zod"

const emailSchema = z.email()
const passwordSchema = z.string().min(1)
const nicknameSchema = z.string().trim().min(1).max(16)

export type AuthMode = "login" | "signup"

export type AuthDraft = Readonly<{
  email: string
  mode: AuthMode
  nickname?: string
  password: string
}>

export type ValidAuthInput =
  | Readonly<{ email: string; mode: "login" }>
  | Readonly<{ email: string; mode: "signup"; nickname: string }>

export type AuthFieldErrors = Readonly<{
  email?: string
  nickname?: string
  password?: string
}>

export type AuthInputResult =
  | Readonly<{ errors: AuthFieldErrors; kind: "invalid" }>
  | Readonly<{ kind: "valid"; value: ValidAuthInput }>

export type NicknameInputResult =
  | Readonly<{ error: string; kind: "invalid" }>
  | Readonly<{ kind: "valid"; nickname: string }>

export function nicknameDisplayLines(nickname: string): readonly string[] {
  const characters = Array.from(nickname)
  if (characters.length <= 8) return [nickname]
  const midpoint = Math.floor(characters.length / 2)
  return [characters.slice(0, midpoint).join(""), characters.slice(midpoint).join("")]
}

export function parseNicknameInput(input: string): NicknameInputResult {
  const nickname = input.trim()
  const parsed = nicknameSchema.safeParse(nickname)
  if (parsed.success) return { kind: "valid", nickname: parsed.data }
  return {
    error: nickname.length > 16 ? "닉네임은 16자까지 입력할 수 있어요." : "닉네임을 입력해 주세요.",
    kind: "invalid",
  }
}

export function parseAuthInput(input: AuthDraft): AuthInputResult {
  const errors: { email?: string; nickname?: string; password?: string } = {}
  const email = input.email.trim()
  if (!emailSchema.safeParse(email).success) errors.email = "이메일 형식을 확인해 주세요."
  if (!passwordSchema.safeParse(input.password).success) {
    errors.password = "비밀번호를 입력해 주세요."
  }
  const nicknameResult = parseNicknameInput(input.nickname ?? "")
  if (input.mode === "signup" && nicknameResult.kind === "invalid") {
    errors.nickname = nicknameResult.error
  }
  if (Object.keys(errors).length > 0) return { errors, kind: "invalid" }
  return input.mode === "signup" && nicknameResult.kind === "valid"
    ? { kind: "valid", value: { email, mode: "signup", nickname: nicknameResult.nickname } }
    : { kind: "valid", value: { email, mode: "login" } }
}
