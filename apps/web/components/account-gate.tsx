"use client"

import { type FormEvent, useState } from "react"
import { ApiClientError, ApiNetworkError, login, signup } from "../lib/api"
import type { Account } from "../lib/contracts"
import { CheckboxField, FormField } from "./form-field"
import { Notice } from "./notice"

type AccountGateProps = {
  readonly onAuthenticated: (account: Account) => void
}

type FormState =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | { readonly kind: "error"; readonly message: string }

type Mode = "login" | "signup"

function accountErrorMessage(error: ApiClientError | ApiNetworkError): string {
  if (error instanceof ApiNetworkError) return "서버에 연결하지 못했습니다. 연결을 확인해 주세요."
  switch (error.code) {
    case "email_conflict":
      return "이미 가입된 이메일입니다. 로그인으로 이어가세요."
    case "credentials_rejected":
      return "이메일 또는 비밀번호가 맞지 않습니다."
    case "rate_limited":
      return "로그인 시도가 많았습니다. 잠시 뒤 다시 확인해 주세요."
    case "invalid_request":
      return "입력 내용을 다시 확인해 주세요."
    default:
      return "요청을 완료하지 못했습니다. 같은 내용으로 다시 확인해 주세요."
  }
}

export function AccountGate({ onAuthenticated }: AccountGateProps) {
  const [mode, setMode] = useState<Mode>("signup")
  const [state, setState] = useState<FormState>({ kind: "idle" })
  const submitting = state.kind === "submitting"

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const email = String(values.get("email") ?? "")
    const password = String(values.get("password") ?? "")
    setState({ kind: "submitting" })
    try {
      const account =
        mode === "signup"
          ? await signup({
              adultSelfAttested: true,
              email,
              password,
              privacyVersion: "2026-08-19",
              termsVersion: "2026-08-19",
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            })
          : await login({ email, password })
      onAuthenticated(account)
    } catch (error) {
      if (error instanceof ApiClientError || error instanceof ApiNetworkError) {
        setState({ kind: "error", message: accountErrorMessage(error) })
        return
      }
      throw error
    }
  }

  return (
    <main className="authShell">
      <header className="authIntro stack">
        <p className="productName">폴리루틴</p>
        <h1>오늘의 한 가지를 함께 지켜봐요</h1>
        <p className="lead">
          한 가지 학습 약속을 만들고, 낯선 성인의 익명 YES/NO 의견을 받아보세요.
        </p>
        <p className="adultNotice">
          만 18세 이상 성인만 이용합니다. 가입 확인은 신원 또는 연령 확인이 아닌 자기 확인입니다.
        </p>
      </header>

      <section className="authPanel" aria-labelledby="account-heading">
        <fieldset className="accountModeFieldset">
          <legend className="formLabel">계정 방식</legend>
          <div className="modeSwitch">
            <button
              aria-pressed={mode === "signup"}
              onClick={() => {
                setMode("signup")
                setState({ kind: "idle" })
              }}
              type="button"
            >
              가입
            </button>
            <button
              aria-pressed={mode === "login"}
              onClick={() => {
                setMode("login")
                setState({ kind: "idle" })
              }}
              type="button"
            >
              로그인
            </button>
          </div>
        </fieldset>
        <div className="stackCompact">
          <p className="eyebrow">성인 전용 계정</p>
          <h2 id="account-heading">{mode === "signup" ? "처음 시작하기" : "다시 이어가기"}</h2>
        </div>
        <form aria-busy={submitting} className="stack" key={mode} onSubmit={handleSubmit}>
          <FormField
            id={`${mode}-email`}
            input={{
              autoComplete: "email",
              disabled: submitting,
              name: "email",
              required: true,
              type: "email",
            }}
            label="이메일"
          />
          <FormField
            {...(mode === "signup" ? { helper: "12자 이상으로 입력하세요." } : {})}
            id={`${mode}-password`}
            input={{
              autoComplete: mode === "signup" ? "new-password" : "current-password",
              disabled: submitting,
              minLength: mode === "signup" ? 12 : 1,
              name: "password",
              required: true,
              type: "password",
            }}
            label="비밀번호"
          />
          {mode === "signup" ? (
            <div className="stack">
              <CheckboxField
                helper="이 확인은 신원 또는 연령 검증이 아닙니다."
                id="adult-attestation"
                input={{ disabled: submitting, name: "adult", required: true }}
                label="만 18세 이상입니다"
              />
              <CheckboxField
                id="policy-consent"
                input={{ disabled: submitting, name: "policy", required: true }}
                label="이용약관과 개인정보 처리방침에 동의합니다"
              />
            </div>
          ) : null}
          {state.kind === "error" ? (
            <Notice announce kind="error">
              {state.message}
            </Notice>
          ) : null}
          <button aria-busy={submitting} className="buttonFull" disabled={submitting} type="submit">
            {submitting ? "서버 확인 중" : mode === "signup" ? "성인으로 시작하기" : "로그인하기"}
          </button>
        </form>
      </section>
    </main>
  )
}
