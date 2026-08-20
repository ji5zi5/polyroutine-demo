import { describe, expect, it } from "vitest"
import {
  createPhotoVerificationModel,
  type PhotoVerificationDependencies,
  type ReadFileResult,
  type StagedPhoto,
} from "./verification-model.js"

const photo: StagedPhoto = {
  arrayBuffer: async () => new ArrayBuffer(1),
  name: "photo.png",
  size: 1,
  type: "image/png",
}

function fakeDependencies(readFile?: (file: StagedPhoto) => Promise<ReadFileResult>): {
  readonly dependencies: PhotoVerificationDependencies
  readonly revokedUrls: string[]
} {
  const revokedUrls: string[] = []
  let nextUrl = 0

  return {
    dependencies: {
      createPreviewUrl: () => {
        nextUrl += 1
        return { kind: "created", url: `blob:trace-${nextUrl}` }
      },
      readFile: readFile ?? (async () => ({ bytes: new ArrayBuffer(1), kind: "read" })),
      revokePreviewUrl: (url) => revokedUrls.push(url),
      scheduler: { cancel: () => {}, schedule: () => 1 },
    },
    revokedUrls,
  }
}

describe("photo verification adversarial state handling", () => {
  it("ignores a late checking success after reset or retry", async () => {
    // Given: a checking photo attempt
    const resetHarness = fakeDependencies()
    const resetModel = createPhotoVerificationModel(resetHarness.dependencies)
    await resetModel.select(photo)
    const resetAttempt = resetModel.state().attempt
    resetModel.startChecking()

    // When: reset invalidates the attempt before its completion arrives
    resetModel.reset()
    resetModel.completeChecking(resetAttempt)

    // Then: the late completion cannot restore success after reset
    expect(resetModel.serialize()).toEqual({ attempt: 2, kind: "idle" })
    expect(resetHarness.revokedUrls).toEqual(["blob:trace-1"])

    // Given: another checking attempt that is superseded by a retryable file error
    const retryHarness = fakeDependencies()
    const retryModel = createPhotoVerificationModel(retryHarness.dependencies)
    await retryModel.select(photo)
    const retryAttempt = retryModel.state().attempt
    retryModel.startChecking()
    await retryModel.select({ ...photo, type: "text/plain" })

    // When: the user starts a fresh retry before the old completion arrives
    retryModel.retry()
    retryModel.completeChecking(retryAttempt)

    // Then: the stale completion leaves the fresh retry untouched
    expect(retryModel.serialize()).toEqual({ attempt: 3, kind: "retry" })
    expect(retryHarness.revokedUrls).toEqual(["blob:trace-1"])
  })

  it("revokes each created object URL exactly once across replacement reset and unmount", async () => {
    // Given: a model whose object URLs are observable
    const harness = fakeDependencies()
    const model = createPhotoVerificationModel(harness.dependencies)

    // When: previews are replaced, reset, and finally unmounted twice
    await model.select(photo)
    await model.select({ ...photo, name: "replacement.png" })
    model.reset()
    await model.select({ ...photo, name: "unmounted.png" })
    model.unmount()
    model.unmount()

    // Then: each of the three preview URLs is released once, with no duplicate cleanup
    expect(harness.revokedUrls).toEqual(["blob:trace-1", "blob:trace-2", "blob:trace-3"])
  })

  it("does not create an object URL for an unreadable selection interrupted by reset", async () => {
    // Given: a selection read that cannot complete until the test releases it
    let continueRead = (): void => {}
    const waitForRead = new Promise<void>((resolve) => {
      continueRead = resolve
    })
    const harness = fakeDependencies(async () => {
      await waitForRead
      return { bytes: new ArrayBuffer(1), kind: "read" }
    })
    const model = createPhotoVerificationModel(harness.dependencies)

    // When: reset wins before the delayed read resolves
    const selection = model.select(photo)
    model.reset()
    continueRead()
    await selection

    // Then: stale file work cannot create a preview or change the reset state
    expect(model.serialize()).toEqual({ attempt: 2, kind: "idle" })
    expect(harness.revokedUrls).toEqual([])
  })
})
