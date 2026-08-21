import type { PhotoVerificationScheduler } from "../../lib/demo-verification/verification-types"

type MotionEnvironment = {
  readonly cancelAnimationFrame: (handle: number) => void
  readonly clearTimeout: (handle: number) => void
  readonly prefersReducedMotion: () => boolean
  readonly requestAnimationFrame: (callback: () => void) => number
  readonly setTimeout: (callback: () => void, delayMs: number) => number
}

type ScheduledCallback = {
  readonly frameHandle: number | null
  readonly timerHandle: number | null
}

export function createMotionAwareVerificationScheduler(
  environment: MotionEnvironment,
): PhotoVerificationScheduler {
  let nextHandle = 0
  const scheduled = new Map<number, ScheduledCallback>()

  const complete = (handle: number, callback: () => void): void => {
    if (!scheduled.delete(handle)) return
    callback()
  }

  return {
    cancel: (handle) => {
      const pending = scheduled.get(handle)
      if (pending === undefined) return
      scheduled.delete(handle)
      if (pending.timerHandle !== null) environment.clearTimeout(pending.timerHandle)
      if (pending.frameHandle !== null) environment.cancelAnimationFrame(pending.frameHandle)
    },
    schedule: (delayMs, callback) => {
      nextHandle += 1
      const handle = nextHandle

      if (!environment.prefersReducedMotion()) {
        const timerHandle = environment.setTimeout(() => complete(handle, callback), delayMs)
        scheduled.set(handle, { frameHandle: null, timerHandle })
        return handle
      }

      const timerHandle = environment.setTimeout(() => {
        if (!scheduled.has(handle)) return
        const frameHandle = environment.requestAnimationFrame(() => complete(handle, callback))
        scheduled.set(handle, { frameHandle, timerHandle: null })
      }, 0)
      scheduled.set(handle, { frameHandle: null, timerHandle })
      return handle
    },
  }
}
