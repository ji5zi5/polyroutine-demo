import type { PersistedPhotoVerificationState, PhotoVerificationState } from "./verification-types"

function assertNever(value: never): never {
  throw new TypeError(`Unexpected verification state: ${JSON.stringify(value)}`)
}

export function persistedState<ErrorCode extends string>(
  state: PhotoVerificationState<ErrorCode>,
): PersistedPhotoVerificationState<ErrorCode> {
  switch (state.kind) {
    case "error":
      return { attempt: state.attempt, error: state.error, kind: state.kind }
    case "idle":
    case "selected":
    case "preview":
    case "checking":
    case "success":
    case "retry":
      return { attempt: state.attempt, kind: state.kind }
    default:
      return assertNever(state)
  }
}

export function previewUrlFor<ErrorCode extends string>(
  state: PhotoVerificationState<ErrorCode>,
): string | null {
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
