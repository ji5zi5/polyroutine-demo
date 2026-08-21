import {
  PHOTO_CHECK_DELAY_MS,
  type PhotoVerificationError,
  selectionError,
} from "./verification-policy"
import { persistedState, previewUrlFor } from "./verification-projection"
import type {
  PersistedPhotoVerificationState,
  PhotoVerificationDependencies,
  PhotoVerificationState,
  StagedPhoto,
} from "./verification-types"

export type { PhotoVerificationError } from "./verification-policy"
export {
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_STAGED_PHOTO_BYTES,
  PHOTO_CHECK_DELAY_MS,
  PHOTO_VERIFICATION_ERROR_MESSAGES,
} from "./verification-policy"
export type {
  PersistedPhotoVerificationState,
  PhotoVerificationDependencies,
  PhotoVerificationScheduler,
  PhotoVerificationState,
  PreviewUrlResult,
  ReadFileResult,
  StagedPhoto,
} from "./verification-types"

export const VERIFICATION_STATE_KINDS = [
  "idle",
  "selected",
  "preview",
  "checking",
  "success",
  "error",
  "retry",
] as const

export type PhotoVerificationModel = {
  readonly completeChecking: (attempt: number) => PhotoVerificationState<PhotoVerificationError>
  readonly reset: () => PhotoVerificationState<PhotoVerificationError>
  readonly retry: () => PhotoVerificationState<PhotoVerificationError>
  readonly select: (file: StagedPhoto) => Promise<PhotoVerificationState<PhotoVerificationError>>
  readonly serialize: () => PersistedPhotoVerificationState<PhotoVerificationError>
  readonly startChecking: () => PhotoVerificationState<PhotoVerificationError>
  readonly state: () => PhotoVerificationState<PhotoVerificationError>
  readonly unmount: () => void
}

type ScheduledCheck = { readonly attempt: number; readonly handle: number }

function errorState(
  attempt: number,
  error: PhotoVerificationError,
): PhotoVerificationState<PhotoVerificationError> {
  return { attempt, error, kind: "error" }
}

/**
 * The only owner of each created object URL and scheduled check. It revokes
 * every URL and cancels every scheduled completion exactly once on replacement,
 * reset, success, retry, or unmount. Persistence excludes transient values.
 */
class InMemoryPhotoVerificationModel implements PhotoVerificationModel {
  private activeScheduledCheck: ScheduledCheck | null = null
  private current: PhotoVerificationState<PhotoVerificationError> = { attempt: 0, kind: "idle" }

  public constructor(private readonly dependencies: PhotoVerificationDependencies) {}

  public state(): PhotoVerificationState<PhotoVerificationError> {
    return this.current
  }

  public async select(file: StagedPhoto): Promise<PhotoVerificationState<PhotoVerificationError>> {
    this.cancelPendingChecking()
    this.releaseCurrentPreview()
    const attempt = this.current.kind === "retry" ? this.current.attempt : this.nextAttempt()
    this.current = { attempt, file, kind: "selected" }

    const validationError = selectionError(file)
    if (validationError !== null) {
      this.current = errorState(attempt, validationError)
      return this.current
    }

    const readResult = await this.dependencies.readFile(file)
    if (!this.isCurrentSelection(attempt)) return this.current

    switch (readResult.kind) {
      case "unreadable":
        this.current = errorState(attempt, "unreadable-file")
        return this.current
      case "read":
        if (readResult.bytes.byteLength === 0) {
          this.current = errorState(attempt, "unreadable-file")
          return this.current
        }
        return this.createPreview(file, attempt)
      default:
        return assertNever(readResult)
    }
  }

  public startChecking(): PhotoVerificationState<PhotoVerificationError> {
    switch (this.current.kind) {
      case "preview": {
        const { attempt, file, previewUrl } = this.current
        this.current = { attempt, file, kind: "checking", previewUrl }
        const handle = this.dependencies.scheduler.schedule(PHOTO_CHECK_DELAY_MS, () => {
          this.completeChecking(attempt)
        })
        if (this.current.kind === "checking" && this.current.attempt === attempt) {
          this.activeScheduledCheck = { attempt, handle }
        } else {
          this.dependencies.scheduler.cancel(handle)
        }
        return this.current
      }
      case "idle":
      case "selected":
      case "checking":
      case "success":
      case "error":
      case "retry":
        return this.current
      default:
        return assertNever(this.current)
    }
  }

  public completeChecking(attempt: number): PhotoVerificationState<PhotoVerificationError> {
    if (this.current.kind !== "checking" || this.current.attempt !== attempt) return this.current

    this.cancelPendingChecking()
    this.releaseCurrentPreview()
    this.current = { attempt, kind: "success" }
    return this.current
  }

  public retry(): PhotoVerificationState<PhotoVerificationError> {
    this.cancelPendingChecking()
    switch (this.current.kind) {
      case "error":
        this.current = { attempt: this.nextAttempt(), kind: "retry" }
        return this.current
      case "idle":
      case "selected":
      case "preview":
      case "checking":
      case "success":
      case "retry":
        return this.current
      default:
        return assertNever(this.current)
    }
  }

  public reset(): PhotoVerificationState<PhotoVerificationError> {
    this.cancelPendingChecking()
    this.releaseCurrentPreview()
    this.current = { attempt: this.nextAttempt(), kind: "idle" }
    return this.current
  }

  public unmount(): void {
    this.reset()
  }

  public serialize(): PersistedPhotoVerificationState<PhotoVerificationError> {
    return persistedState(this.current)
  }

  private cancelPendingChecking(): void {
    const scheduled = this.activeScheduledCheck
    if (scheduled === null) return
    this.activeScheduledCheck = null
    this.dependencies.scheduler.cancel(scheduled.handle)
  }

  private createPreview(
    file: StagedPhoto,
    attempt: number,
  ): PhotoVerificationState<PhotoVerificationError> {
    const previewResult = this.dependencies.createPreviewUrl(file)
    switch (previewResult.kind) {
      case "created":
        if (previewResult.url === "") {
          this.current = errorState(attempt, "preview-creation-failed")
          return this.current
        }
        this.current = { attempt, file, kind: "preview", previewUrl: previewResult.url }
        return this.current
      case "failed":
        this.current = errorState(attempt, "preview-creation-failed")
        return this.current
      default:
        return assertNever(previewResult)
    }
  }

  private isCurrentSelection(attempt: number): boolean {
    return this.current.kind === "selected" && this.current.attempt === attempt
  }

  private nextAttempt(): number {
    return this.current.attempt + 1
  }

  private releaseCurrentPreview(): void {
    const previewUrl = previewUrlFor(this.current)
    if (previewUrl !== null) this.dependencies.revokePreviewUrl(previewUrl)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected verification state: ${JSON.stringify(value)}`)
}

export function createPhotoVerificationModel(
  dependencies: PhotoVerificationDependencies,
): PhotoVerificationModel {
  return new InMemoryPhotoVerificationModel(dependencies)
}
