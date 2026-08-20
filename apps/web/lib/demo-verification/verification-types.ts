export type StagedPhoto = {
  readonly arrayBuffer: () => Promise<ArrayBuffer>
  readonly name: string
  readonly size: number
  readonly type: string
}

export type ReadFileResult =
  | { readonly bytes: ArrayBuffer; readonly kind: "read" }
  | { readonly kind: "unreadable" }

export type PreviewUrlResult =
  | { readonly kind: "created"; readonly url: string }
  | { readonly kind: "failed" }

export type PhotoVerificationScheduler = {
  readonly cancel: (handle: number) => void
  readonly schedule: (delayMs: number, callback: () => void) => number
}

export type PhotoVerificationDependencies = {
  readonly createPreviewUrl: (file: StagedPhoto) => PreviewUrlResult
  readonly readFile: (file: StagedPhoto) => Promise<ReadFileResult>
  readonly revokePreviewUrl: (url: string) => void
  readonly scheduler: PhotoVerificationScheduler
}

export type IdleState = { readonly attempt: number; readonly kind: "idle" }
export type SelectedState = {
  readonly attempt: number
  readonly file: StagedPhoto
  readonly kind: "selected"
}
export type PreviewState = {
  readonly attempt: number
  readonly file: StagedPhoto
  readonly kind: "preview"
  readonly previewUrl: string
}
export type CheckingState = {
  readonly attempt: number
  readonly file: StagedPhoto
  readonly kind: "checking"
  readonly previewUrl: string
}
export type SuccessState = { readonly attempt: number; readonly kind: "success" }
export type ErrorState<ErrorCode extends string> = {
  readonly attempt: number
  readonly error: ErrorCode
  readonly kind: "error"
}
export type RetryState = { readonly attempt: number; readonly kind: "retry" }

export type PhotoVerificationState<ErrorCode extends string> =
  | IdleState
  | SelectedState
  | PreviewState
  | CheckingState
  | SuccessState
  | ErrorState<ErrorCode>
  | RetryState

export type PersistedPhotoVerificationState<ErrorCode extends string> =
  | { readonly attempt: number; readonly kind: "idle" }
  | { readonly attempt: number; readonly kind: "selected" }
  | { readonly attempt: number; readonly kind: "preview" }
  | { readonly attempt: number; readonly kind: "checking" }
  | { readonly attempt: number; readonly kind: "success" }
  | { readonly attempt: number; readonly error: ErrorCode; readonly kind: "error" }
  | { readonly attempt: number; readonly kind: "retry" }
