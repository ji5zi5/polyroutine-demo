"use client"

import { useEffect, useRef, useState } from "react"
import type { AuthFieldErrors, AuthMode, ValidAuthInput } from "../../lib/demo-my/auth-input"
import { parseAuthInput } from "../../lib/demo-my/auth-input"
import styles from "./demo-my.module.css"

type AuthGateProps = Readonly<{
  onAuthenticate: (input: ValidAuthInput) => void
}>

function feedbackId(field: "email" | "nickname" | "password"): string {
  return `demo-auth-${field}-feedback`
}

export function AuthGate({ onAuthenticate }: AuthGateProps) {
  const emailRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<AuthMode>("login")
  const [email, setEmail] = useState("")
  const [nickname, setNickname] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<AuthFieldErrors>({})
  const canSubmit =
    email.trim().length > 0 &&
    password.trim().length > 0 &&
    (mode === "login" || nickname.trim().length > 0)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  const clearDrafts = (nextMode: AuthMode): void => {
    setMode(nextMode)
    setEmail("")
    setNickname("")
    setPassword("")
    setErrors({})
  }

  return (
    <section className={styles["authScreen"]}>
      <div className={styles["authHero"]}>
        <h1>{mode === "login" ? "오늘도 가볍게 시작해요" : "처음 오셨나요?"}</h1>
        <p>{mode === "login" ? "목표를 예측하고 기록해요." : "계정을 만들고 바로 시작해요."}</p>
      </div>
      <form
        className={`${styles["authForm"]} demoLoginForm`}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          const result = parseAuthInput({ email, mode, nickname, password })
          if (result.kind === "invalid") {
            setErrors(result.errors)
            return
          }
          onAuthenticate(result.value)
          setPassword("")
          setErrors({})
        }}
      >
        {mode === "signup" ? (
          <label className={styles["field"]}>
            <span>닉네임</span>
            <input
              aria-describedby={errors.nickname === undefined ? undefined : feedbackId("nickname")}
              aria-invalid={errors.nickname === undefined ? undefined : true}
              autoComplete="nickname"
              maxLength={16}
              onChange={(event) => {
                setNickname(event.target.value)
                setErrors({})
              }}
              placeholder="닉네임 입력"
              value={nickname}
            />
            {errors.nickname === undefined ? null : (
              <small id={feedbackId("nickname")}>{errors.nickname}</small>
            )}
          </label>
        ) : null}
        <label className={styles["field"]}>
          <span>이메일</span>
          <input
            aria-describedby={errors.email === undefined ? undefined : feedbackId("email")}
            aria-invalid={errors.email === undefined ? undefined : true}
            autoComplete="email"
            maxLength={254}
            onChange={(event) => {
              setEmail(event.target.value)
              setErrors({})
            }}
            placeholder="이메일 입력"
            ref={emailRef}
            type="email"
            value={email}
          />
          {errors.email === undefined ? null : (
            <small id={feedbackId("email")}>{errors.email}</small>
          )}
        </label>
        <label className={styles["field"]}>
          <span>비밀번호</span>
          <input
            aria-describedby={errors.password === undefined ? undefined : feedbackId("password")}
            aria-invalid={errors.password === undefined ? undefined : true}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            onChange={(event) => {
              setPassword(event.target.value)
              setErrors({})
            }}
            placeholder="비밀번호 입력"
            type="password"
            value={password}
          />
          {errors.password === undefined ? null : (
            <small id={feedbackId("password")}>{errors.password}</small>
          )}
        </label>
        <button className={styles["primaryAction"]} disabled={!canSubmit} type="submit">
          {mode === "login" ? "로그인" : "회원가입"}
        </button>
        <button
          className={styles["textAction"]}
          onClick={() => clearDrafts(mode === "login" ? "signup" : "login")}
          type="button"
        >
          {mode === "login" ? "회원가입" : "로그인으로 돌아가기"}
        </button>
      </form>
    </section>
  )
}
