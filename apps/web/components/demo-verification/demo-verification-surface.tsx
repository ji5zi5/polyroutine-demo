"use client"

import { useEffect, useId, useRef, useState } from "react"
import {
  createPhotoVerificationModel,
  type PhotoVerificationModel,
} from "../../lib/demo-verification/verification-model"
import type { PhotoVerificationError } from "../../lib/demo-verification/verification-policy"
import type {
  PhotoVerificationDependencies,
  PhotoVerificationState,
  StagedPhoto,
} from "../../lib/demo-verification/verification-types"
import {
  createDemoVerificationSurfaceController,
  type DemoVerificationSurfaceController,
} from "./demo-verification-controller"
import { createMotionAwareVerificationScheduler } from "./demo-verification-scheduler"
import { DemoVerificationSurfaceView } from "./demo-verification-surface-view"

export { createDemoVerificationSurfaceController } from "./demo-verification-controller"
export { DemoVerificationSurfaceView } from "./demo-verification-surface-view"

type DemoVerificationSurfaceProps = {
  readonly goal: string
  readonly onSettled: () => void
}

function isBrowserBlob(file: StagedPhoto): file is StagedPhoto & Blob {
  return file instanceof Blob
}

function browserDependencies(onCheckingComplete: () => void): PhotoVerificationDependencies {
  const motionScheduler = createMotionAwareVerificationScheduler({
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
    clearTimeout: (handle) => window.clearTimeout(handle),
    prefersReducedMotion: () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  })

  return {
    createPreviewUrl: (file) => {
      if (!isBrowserBlob(file)) return { kind: "failed" }
      try {
        return { kind: "created", url: URL.createObjectURL(file) }
      } catch (error) {
        if (error instanceof DOMException || error instanceof TypeError) return { kind: "failed" }
        throw error
      }
    },
    readFile: async (file) => {
      try {
        return { bytes: await file.arrayBuffer(), kind: "read" }
      } catch (error) {
        if (error instanceof DOMException || error instanceof TypeError)
          return { kind: "unreadable" }
        throw error
      }
    },
    revokePreviewUrl: (url) => URL.revokeObjectURL(url),
    scheduler: {
      cancel: motionScheduler.cancel,
      schedule: (delayMs, callback) =>
        motionScheduler.schedule(delayMs, () => {
          callback()
          onCheckingComplete()
        }),
    },
  }
}

export function DemoVerificationSurface({ goal, onSettled }: DemoVerificationSurfaceProps) {
  const inputId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const retryButtonRef = useRef<HTMLButtonElement>(null)
  const onSettledRef = useRef(onSettled)
  const [settlementRequested, setSettlementRequested] = useState(false)
  const [shouldFocusFileInput, setShouldFocusFileInput] = useState(false)
  const [state, setState] = useState<PhotoVerificationState<PhotoVerificationError>>({
    attempt: 0,
    kind: "idle",
  })
  const controllerRef = useRef<DemoVerificationSurfaceController | null>(null)

  if (controllerRef.current === null) {
    const model: PhotoVerificationModel = createPhotoVerificationModel(
      browserDependencies(() => {
        const controller = controllerRef.current
        if (controller !== null) setState(controller.state())
      }),
    )
    controllerRef.current = createDemoVerificationSurfaceController({
      model,
      onChange: setState,
      onFocusRequested: () => setShouldFocusFileInput(true),
      onSettled: () => {
        setSettlementRequested(true)
        onSettledRef.current()
      },
    })
  }

  const controller = controllerRef.current

  useEffect(() => {
    onSettledRef.current = onSettled
  }, [onSettled])

  useEffect(() => {
    if (state.kind !== "error") return
    const retryButton = retryButtonRef.current
    retryButton?.closest<HTMLElement>("[data-verification-scroll-container]")?.scrollTo({ top: 0 })
    retryButton?.focus({ preventScroll: true })
  }, [state.kind])

  useEffect(() => {
    if (!shouldFocusFileInput) return
    fileInputRef.current?.focus({ preventScroll: true })
    setShouldFocusFileInput(false)
  }, [shouldFocusFileInput])

  useEffect(() => () => controller.unmount(), [controller])

  return (
    <DemoVerificationSurfaceView
      fileInputRef={fileInputRef}
      goal={goal}
      inputId={inputId}
      onFileSelected={(file: StagedPhoto) => void controller.select(file)}
      onReset={() => {
        setSettlementRequested(false)
        controller.reset()
      }}
      onRetry={controller.retry}
      onSettle={controller.settle}
      onStartChecking={controller.startChecking}
      retryButtonRef={retryButtonRef}
      settlementRequested={settlementRequested}
      state={state}
    />
  )
}
