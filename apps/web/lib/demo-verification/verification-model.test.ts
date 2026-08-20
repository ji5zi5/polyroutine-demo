import { describe, expect, it } from "vitest"
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  createPhotoVerificationModel,
  MAX_STAGED_PHOTO_BYTES,
  type PhotoVerificationDependencies,
  type StagedPhoto,
} from "./verification-model.js"

function stagedPhoto(overrides: Partial<StagedPhoto> = {}): StagedPhoto {
  return {
    arrayBuffer: async () => new ArrayBuffer(1),
    name: "routine.png",
    size: 1,
    type: "image/png",
    ...overrides,
  }
}

function dependencies(overrides: Partial<PhotoVerificationDependencies> = {}): {
  readonly dependencies: PhotoVerificationDependencies
  readonly revokedUrls: string[]
} {
  const revokedUrls: string[] = []
  let urlNumber = 0

  return {
    dependencies: {
      createPreviewUrl: () => {
        urlNumber += 1
        return { kind: "created", url: `blob:demo-${urlNumber}` }
      },
      readFile: async () => ({ kind: "read", bytes: new ArrayBuffer(1) }),
      revokePreviewUrl: (url) => revokedUrls.push(url),
      scheduler: { cancel: () => {}, schedule: () => 1 },
      ...overrides,
    },
    revokedUrls,
  }
}

describe("photo verification state model", () => {
  it("moves a valid PNG through the deterministic staging and checking states", async () => {
    // Given: a readable accepted PNG and deterministic object-URL dependencies
    const harness = dependencies()
    const model = createPhotoVerificationModel(harness.dependencies)
    const trace = [model.state().kind]

    // When: the PNG is selected, previewed, and checked
    const selection = model.select(stagedPhoto())
    trace.push(model.state().kind)
    await selection
    trace.push(model.state().kind)
    const attempt = model.state().attempt
    model.startChecking()
    trace.push(model.state().kind)
    model.completeChecking(attempt)
    trace.push(model.state().kind)

    // Then: valid image files always reach success without semantic verification claims
    expect(trace).toEqual(["idle", "selected", "preview", "checking", "success"])
    expect(model.serialize()).toEqual({ attempt, kind: "success" })
    expect(harness.revokedUrls).toEqual(["blob:demo-1"])
  })

  it("accepts only the declared image MIME types under the explicit size cap", async () => {
    // Given: the model boundary and its declared upload policy
    const accepted = ACCEPTED_IMAGE_MIME_TYPES.map((type) => stagedPhoto({ type }))
    const atTheCap = stagedPhoto({ size: MAX_STAGED_PHOTO_BYTES })

    // When: each accepted file is staged
    const states = await Promise.all(
      [...accepted, atTheCap].map(async (file) => {
        const model = createPhotoVerificationModel(dependencies().dependencies)
        await model.select(file)
        return model.state().kind
      }),
    )

    // Then: every declared type and the exact cap produce previews
    expect(states).toEqual(["preview", "preview", "preview", "preview"])
  })

  it("returns only the permitted user-facing selection errors", async () => {
    // Given: malformed, oversized, unreadable, and preview-failing selections
    const fixtures = [
      {
        dependencies: dependencies().dependencies,
        file: stagedPhoto({ type: "text/plain" }),
        error: "non-image",
      },
      {
        dependencies: dependencies().dependencies,
        file: stagedPhoto({ size: MAX_STAGED_PHOTO_BYTES + 1 }),
        error: "oversize",
      },
      {
        dependencies: dependencies({ readFile: async () => ({ kind: "unreadable" }) }).dependencies,
        file: stagedPhoto({ size: 0 }),
        error: "unreadable-file",
      },
      {
        dependencies: dependencies({ createPreviewUrl: () => ({ kind: "failed" }) }).dependencies,
        file: stagedPhoto(),
        error: "preview-creation-failed",
      },
    ] as const

    // When: each selection is staged
    const errors = await Promise.all(
      fixtures.map(async ({ dependencies: fixtureDependencies, file }) => {
        const model = createPhotoVerificationModel(fixtureDependencies)
        await model.select(file)
        return model.serialize()
      }),
    )

    // Then: every failure is a supported file-staging error and nothing else
    expect(errors).toEqual([
      { attempt: 1, error: "non-image", kind: "error" },
      { attempt: 1, error: "oversize", kind: "error" },
      { attempt: 1, error: "unreadable-file", kind: "error" },
      { attempt: 1, error: "preview-creation-failed", kind: "error" },
    ])
  })

  it("starts a fresh retry and serializes no File Blob or object URL", async () => {
    // Given: a failed unreadable-file selection
    const model = createPhotoVerificationModel(
      dependencies({ readFile: async () => ({ kind: "unreadable" }) }).dependencies,
    )
    await model.select(stagedPhoto())

    // When: the user starts another attempt
    const retry = model.retry()
    const persisted = JSON.stringify(model.serialize())

    // Then: retry is explicit and persisted data excludes transient file data
    expect(retry).toMatchObject({ attempt: 2, kind: "retry" })
    expect(persisted).not.toContain("blob:")
    expect(persisted).not.toContain("routine.png")
  })
})
