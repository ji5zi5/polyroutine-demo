import type { PhotoVerificationModel } from "../../lib/demo-verification/verification-model"
import type { PhotoVerificationError } from "../../lib/demo-verification/verification-policy"
import type {
  PhotoVerificationState,
  StagedPhoto,
} from "../../lib/demo-verification/verification-types"

export type DemoVerificationSurfaceController = {
  readonly reset: () => void
  readonly retry: () => void
  readonly select: (file: StagedPhoto) => Promise<void>
  readonly settle: () => boolean
  readonly startChecking: () => void
  readonly state: () => PhotoVerificationState<PhotoVerificationError>
  readonly unmount: () => void
}

export type DemoVerificationFocusTarget = "file-input"

type DemoVerificationSurfaceControllerOptions = {
  readonly model: PhotoVerificationModel
  readonly onChange: (state: PhotoVerificationState<PhotoVerificationError>) => void
  readonly onFocusRequested?: (target: DemoVerificationFocusTarget) => void
  readonly onSettled: () => void
}

export function createDemoVerificationSurfaceController({
  model,
  onChange,
  onFocusRequested,
  onSettled,
}: DemoVerificationSurfaceControllerOptions): DemoVerificationSurfaceController {
  let settlementRequested = false

  const notify = (): void => onChange(model.state())

  return {
    reset: () => {
      settlementRequested = false
      model.reset()
      notify()
    },
    retry: () => {
      const next = model.retry()
      notify()
      if (next.kind === "retry") onFocusRequested?.("file-input")
    },
    select: async (file) => {
      const selection = model.select(file)
      notify()
      await selection
      notify()
    },
    settle: () => {
      if (settlementRequested || model.state().kind !== "success") return false
      settlementRequested = true
      onSettled()
      return true
    },
    startChecking: () => {
      model.startChecking()
      notify()
    },
    state: () => model.state(),
    unmount: () => model.unmount(),
  }
}
