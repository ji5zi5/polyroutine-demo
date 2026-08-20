import { describe, expect, it } from "vitest"
import { createPhotoVerificationModel } from "./verification-model.js"

function fakeScheduler(): {
  readonly cancel: (handle: number) => void
  readonly cancelled: readonly number[]
  readonly run: (handle: number) => void
  readonly scheduled: readonly { readonly delayMs: number; readonly handle: number }[]
  readonly schedule: (delayMs: number, callback: () => void) => number
} {
  const callbacks = new Map<number, () => void>()
  const cancelled: number[] = []
  const scheduled: { delayMs: number; handle: number }[] = []
  let nextHandle = 0

  return {
    cancel: (handle) => cancelled.push(handle),
    cancelled,
    run: (handle) => {
      const callback = callbacks.get(handle)
      if (callback === undefined) throw new TypeError("Unknown scheduled verification")
      callback()
    },
    scheduled,
    schedule: (delayMs, callback) => {
      nextHandle += 1
      callbacks.set(nextHandle, callback)
      scheduled.push({ delayMs, handle: nextHandle })
      return nextHandle
    },
  }
}

describe("photo verification scheduler", () => {
  it("schedules deterministic success after the checking stage", async () => {
    // Given: a valid staged image and an injected scheduler
    const scheduler = fakeScheduler()
    const model = createPhotoVerificationModel({
      createPreviewUrl: () => ({ kind: "created", url: "blob:scheduled" }),
      readFile: async () => ({ bytes: new ArrayBuffer(1), kind: "read" }),
      revokePreviewUrl: () => {},
      scheduler,
    })
    await model.select({
      arrayBuffer: async () => new ArrayBuffer(1),
      name: "scheduled.png",
      size: 1,
      type: "image/png",
    })

    // When: checking starts and the fake timer runs
    model.startChecking()
    expect(scheduler.scheduled).toEqual([{ delayMs: 1_000, handle: 1 }])
    const scheduled = scheduler.scheduled[0]
    if (scheduled === undefined) return
    scheduler.run(scheduled.handle)

    // Then: success occurs through the injected scheduler rather than a manual completion call
    expect(model.state().kind).toBe("success")
    expect(scheduler.cancelled).toEqual([1])
  })

  it("cancels reset and unmount checks exactly once before their stale callbacks run", async () => {
    // Given: two independent checking attempts scheduled by fake timers
    const resetScheduler = fakeScheduler()
    const resetModel = createPhotoVerificationModel({
      createPreviewUrl: () => ({ kind: "created", url: "blob:reset" }),
      readFile: async () => ({ bytes: new ArrayBuffer(1), kind: "read" }),
      revokePreviewUrl: () => {},
      scheduler: resetScheduler,
    })
    await resetModel.select({
      arrayBuffer: async () => new ArrayBuffer(1),
      name: "reset.png",
      size: 1,
      type: "image/png",
    })
    resetModel.startChecking()

    // When: reset invalidates its scheduled callback, then the callback arrives late
    resetModel.reset()
    resetModel.reset()
    resetScheduler.run(1)

    // Then: reset is stable and its timer handle is cancelled once
    expect(resetModel.serialize()).toEqual({ attempt: 3, kind: "idle" })
    expect(resetScheduler.cancelled).toEqual([1])

    // Given: an independent unmount path
    const unmountScheduler = fakeScheduler()
    const unmountModel = createPhotoVerificationModel({
      createPreviewUrl: () => ({ kind: "created", url: "blob:unmount" }),
      readFile: async () => ({ bytes: new ArrayBuffer(1), kind: "read" }),
      revokePreviewUrl: () => {},
      scheduler: unmountScheduler,
    })
    await unmountModel.select({
      arrayBuffer: async () => new ArrayBuffer(1),
      name: "unmount.png",
      size: 1,
      type: "image/png",
    })
    unmountModel.startChecking()

    // When: unmount runs twice before its stale callback
    unmountModel.unmount()
    unmountModel.unmount()
    unmountScheduler.run(1)

    // Then: unmount prevents late success and does not cancel twice
    expect(unmountModel.serialize()).toEqual({ attempt: 3, kind: "idle" })
    expect(unmountScheduler.cancelled).toEqual([1])
  })

  it("cancels replacement and retry paths while preserving stale-attempt suppression", async () => {
    // Given: a valid image check with a controllable scheduled completion
    const scheduler = fakeScheduler()
    const model = createPhotoVerificationModel({
      createPreviewUrl: () => ({ kind: "created", url: "blob:replacement" }),
      readFile: async () => ({ bytes: new ArrayBuffer(1), kind: "read" }),
      revokePreviewUrl: () => {},
      scheduler,
    })
    const validPhoto = {
      arrayBuffer: async () => new ArrayBuffer(1),
      name: "replacement.png",
      size: 1,
      type: "image/png",
    }
    await model.select(validPhoto)
    model.startChecking()

    // When: replacement changes the model to an error and retry starts a new attempt
    await model.select({ ...validPhoto, type: "text/plain" })
    model.retry()
    scheduler.run(1)

    // Then: replacement cancelled the old check and its callback cannot leave retry
    expect(scheduler.cancelled).toEqual([1])
    expect(model.serialize()).toEqual({ attempt: 3, kind: "retry" })
  })
})
