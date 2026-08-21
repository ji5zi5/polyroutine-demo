import Image from "next/image"
import { type ChangeEvent, createElement, type RefObject } from "react"
import type { PhotoVerificationError } from "../../lib/demo-verification/verification-policy"
import { PHOTO_VERIFICATION_ERROR_MESSAGES } from "../../lib/demo-verification/verification-policy"
import type {
  PhotoVerificationState,
  StagedPhoto,
} from "../../lib/demo-verification/verification-types"
import styles from "./demo-verification-surface.module.css"

type DemoVerificationSurfaceViewProps = {
  readonly fileInputRef?: RefObject<HTMLInputElement | null>
  readonly goal: string
  readonly inputId?: string
  readonly onFileSelected: (file: StagedPhoto) => void
  readonly onReset: () => void
  readonly onRetry: () => void
  readonly onSettle: () => void
  readonly onStartChecking: () => void
  readonly retryButtonRef?: RefObject<HTMLButtonElement | null>
  readonly settlementRequested: boolean
  readonly state: PhotoVerificationState<PhotoVerificationError>
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected verification surface state: ${JSON.stringify(value)}`)
}

function fileFor(state: PhotoVerificationState<PhotoVerificationError>): StagedPhoto | null {
  switch (state.kind) {
    case "selected":
    case "preview":
    case "checking":
      return state.file
    case "idle":
    case "success":
    case "error":
    case "retry":
      return null
    default:
      return assertNever(state)
  }
}

function previewFor(state: PhotoVerificationState<PhotoVerificationError>): string | null {
  switch (state.kind) {
    case "preview":
    case "checking":
      return state.previewUrl
    case "idle":
    case "selected":
    case "success":
    case "error":
    case "retry":
      return null
    default:
      return assertNever(state)
  }
}

function stateDescription(state: PhotoVerificationState<PhotoVerificationError>): string {
  switch (state.kind) {
    case "idle":
    case "retry":
      return "사진을 선택해 주세요."
    case "selected":
      return "파일을 준비하고 있어요."
    case "preview":
      return "사진 미리보기를 준비했어요."
    case "checking":
      return "사진의 파일 형식과 미리보기를 확인하고 있어요."
    case "success":
      return "파일 형식과 미리보기를 확인했어요."
    case "error":
      return PHOTO_VERIFICATION_ERROR_MESSAGES[state.error]
    default:
      return assertNever(state)
  }
}

function handleFileChange(
  event: ChangeEvent<HTMLInputElement>,
  onFileSelected: (file: StagedPhoto) => void,
): void {
  const file = event.currentTarget.files?.item(0)
  event.currentTarget.value = ""
  if (file !== null && file !== undefined) onFileSelected(file)
}

export function DemoVerificationSurfaceView({
  fileInputRef,
  goal,
  inputId = "demo-verification-photo",
  onFileSelected,
  onReset,
  onRetry,
  onSettle,
  onStartChecking,
  retryButtonRef,
  settlementRequested,
  state,
}: DemoVerificationSurfaceViewProps) {
  const file = fileFor(state)
  const previewUrl = previewFor(state)
  const inputDisabled = state.kind === "checking" || state.kind === "success"
  const startDisabled = state.kind !== "preview"
  const isError = state.kind === "error"
  const isChecking = state.kind === "checking"
  const isSuccess = state.kind === "success"

  const fileSelector = createElement(
    "label",
    { className: styles["fileSelect"], htmlFor: inputId },
    createElement("span", null, file === null ? "사진 선택하기" : "다른 사진 선택"),
    createElement("input", {
      accept: "image/jpeg,image/png,image/webp",
      "aria-describedby": "demo-verification-title",
      capture: "environment",
      className: styles["fileInput"],
      disabled: inputDisabled,
      id: inputId,
      onChange: (event: ChangeEvent<HTMLInputElement>) => handleFileChange(event, onFileSelected),
      ref: fileInputRef,
      type: "file",
    }),
  )
  const retryAction = isError
    ? createElement(
        "button",
        {
          className: styles["secondaryAction"],
          "data-verification-action": "retry",
          onClick: onRetry,
          ref: retryButtonRef,
          type: "button",
        },
        "다시 시도하기",
      )
    : null
  const primaryAction = isSuccess
    ? createElement(
        "button",
        {
          className: styles["primaryAction"],
          "data-verification-action": "settle",
          disabled: settlementRequested,
          onClick: onSettle,
          type: "button",
        },
        settlementRequested ? "정산 결과를 열고 있어요" : "정산 결과 보기",
      )
    : createElement(
        "button",
        {
          className: styles["primaryAction"],
          "data-verification-action": "start",
          disabled: startDisabled,
          onClick: onStartChecking,
          type: "button",
        },
        isChecking ? "사진 확인 중" : "사진 확인하기",
      )
  const resetAction =
    isError || state.kind === "retry"
      ? createElement(
          "button",
          { className: styles["resetAction"], onClick: onReset, type: "button" },
          "처음으로 돌아가기",
        )
      : null

  return createElement(
    "section",
    { "aria-labelledby": "demo-verification-title", className: styles["surface"] },
    createElement(
      "header",
      { className: styles["heading"] },
      createElement("h2", { id: "demo-verification-title" }, "사진 확인"),
      createElement("p", null, "파일 형식과 미리보기만 확인하는 데모예요"),
    ),
    createElement(
      "dl",
      { className: styles["context"] },
      createElement(
        "div",
        null,
        createElement("dt", null, "오늘의 목표"),
        createElement("dd", null, goal),
      ),
      file === null
        ? null
        : createElement(
            "div",
            null,
            createElement("dt", null, "선택한 파일"),
            createElement("dd", null, file.name),
          ),
    ),
    previewUrl === null
      ? null
      : createElement(
          "figure",
          { className: styles["preview"] },
          createElement(Image, {
            alt: "선택한 사진 미리보기",
            className: styles["previewImage"],
            fill: true,
            sizes: "100vw",
            src: previewUrl,
            unoptimized: true,
          }),
        ),
    createElement(
      "div",
      {
        "aria-atomic": "true",
        "aria-busy": isChecking,
        "aria-live": isError ? "assertive" : "polite",
        className: isError ? styles["error"] : isSuccess ? styles["success"] : styles["status"],
        role: isError ? "alert" : "status",
        tabIndex: isError ? -1 : undefined,
      },
      createElement("p", null, stateDescription(state)),
    ),
    createElement(
      "div",
      { className: styles["actions"] },
      isSuccess ? null : fileSelector,
      retryAction,
      primaryAction,
      resetAction,
    ),
  )
}
