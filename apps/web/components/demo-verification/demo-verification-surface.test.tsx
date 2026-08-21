import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { createPhotoVerificationModel } from "../../lib/demo-verification/verification-model.js"
import type { PhotoVerificationError } from "../../lib/demo-verification/verification-policy.js"
import type {
  PhotoVerificationDependencies,
  PhotoVerificationState,
  StagedPhoto,
} from "../../lib/demo-verification/verification-types.js"
import { createDemoVerificationSurfaceController } from "./demo-verification-controller.js"
import { createMotionAwareVerificationScheduler } from "./demo-verification-scheduler.js"
import { DemoVerificationSurfaceView } from "./demo-verification-surface-view.js"

function photo(overrides: Partial<StagedPhoto> = {}): StagedPhoto {
  return {
    arrayBuffer: async () => new ArrayBuffer(1),
    name: "routine.png",
    size: 1,
    type: "image/png",
    ...overrides,
  }
}

function dependencies(): {
  readonly dependencies: PhotoVerificationDependencies
  readonly revokedUrls: readonly string[]
  readonly run: (handle: number) => void
} {
  const callbacks = new Map<number, () => void>()
  const revokedUrls: string[] = []
  let nextHandle = 0

  return {
    dependencies: {
      createPreviewUrl: () => ({ kind: "created", url: "blob:component-test" }),
      readFile: async () => ({ bytes: new ArrayBuffer(1), kind: "read" }),
      revokePreviewUrl: (url) => revokedUrls.push(url),
      scheduler: {
        cancel: () => {},
        schedule: (_delayMs, callback) => {
          nextHandle += 1
          callbacks.set(nextHandle, callback)
          return nextHandle
        },
      },
    },
    revokedUrls,
    run: (handle) => {
      const callback = callbacks.get(handle)
      if (callback === undefined) throw new TypeError("Unknown scheduled check")
      callback()
    },
  }
}

function render(
  state: PhotoVerificationState<PhotoVerificationError>,
  goal = "정보처리기사 3장 요약",
): string {
  return renderToStaticMarkup(
    createElement(DemoVerificationSurfaceView, {
      goal,
      onFileSelected: () => {},
      onReset: () => {},
      onRetry: () => {},
      onSettle: () => {},
      onStartChecking: () => {},
      settlementRequested: false,
      state,
    }),
  )
}

describe("demo verification surface", () => {
  it("renders a disabled check action before a file is ready and preserves staged context while checking", () => {
    // Given: a screen before selection and a staged checking state
    const idle = render({ attempt: 0, kind: "idle" })
    const checking = render({
      attempt: 1,
      file: photo({ name: "today-note.png" }),
      kind: "checking",
      previewUrl: "blob:checking",
    })

    // When: each state is rendered as accessible markup
    const disabledAction = /data-verification-action="start" disabled=""/.test(idle)

    // Then: the action is gated and checking keeps the goal and chosen file visible
    expect(disabledAction).toBe(true)
    expect(checking).toContain('aria-busy="true"')
    expect(checking).toContain("정보처리기사 3장 요약")
    expect(checking).toContain("today-note.png")
  })

  it("renders file errors with a retry target and an explicit success settlement action", () => {
    // Given: objective file staging outcomes
    const error = render({ attempt: 1, error: "non-image", kind: "error" })
    const success = render({ attempt: 1, kind: "success" })

    // When: the error and success states are rendered
    const retryTarget = /data-verification-action="retry"/.test(error)
    const settlementAction = /data-verification-action="settle"/.test(success)

    // Then: error recovery and settlement are separately actionable
    expect(error).toContain('role="alert"')
    expect(retryTarget).toBe(true)
    expect(settlementAction).toBe(true)
    expect(success).toContain("파일 형식과 미리보기만 확인하는 데모예요")
  })

  it("settles only after deterministic success and releases the staged URL when unmounted", async () => {
    // Given: a controller backed by the committed verification state model
    const harness = dependencies()
    const states: string[] = []
    let settlementCount = 0
    const controller = createDemoVerificationSurfaceController({
      model: createPhotoVerificationModel(harness.dependencies),
      onChange: (state) => states.push(state.kind),
      onSettled: () => {
        settlementCount += 1
      },
    })

    // When: a valid file completes and settlement is requested twice
    await controller.select(photo())
    controller.startChecking()
    harness.run(1)
    const completedState = controller.state().kind
    const firstSettlement = controller.settle()
    const secondSettlement = controller.settle()
    controller.unmount()

    // Then: settlement is explicit and idempotent, and the created URL is cleaned up
    expect(states).toEqual(["selected", "preview", "checking"])
    expect(completedState).toBe("success")
    expect(firstSettlement).toBe(true)
    expect(secondSettlement).toBe(false)
    expect(settlementCount).toBe(1)
    expect(harness.revokedUrls).toEqual(["blob:component-test"])
  })

  it("keeps malformed selections objective and suppresses stale checks after reset replacement and unmount", async () => {
    // Given: a controller whose scheduler can deliver cancelled callbacks late
    const harness = dependencies()
    const controller = createDemoVerificationSurfaceController({
      model: createPhotoVerificationModel(harness.dependencies),
      onChange: () => {},
      onSettled: () => {},
    })

    // When: malformed, reset, replacement, retry, and unmount paths interrupt checking
    await controller.select(photo({ type: "text/plain" }))
    const malformedState = controller.state()
    controller.retry()
    await controller.select(photo({ name: "reset.png" }))
    controller.startChecking()
    controller.reset()
    harness.run(1)
    await controller.select(photo({ name: "replace.png" }))
    controller.startChecking()
    await controller.select(photo({ type: "text/plain" }))
    controller.retry()
    harness.run(2)
    await controller.select(photo({ name: "unmount.png" }))
    controller.startChecking()
    controller.unmount()
    harness.run(3)

    // Then: only file-format errors appear and late callbacks cannot manufacture success
    expect(malformedState).toEqual({ attempt: 1, error: "non-image", kind: "error" })
    expect(controller.state()).toEqual({ attempt: 7, kind: "idle" })
    expect(harness.revokedUrls).toEqual([
      "blob:component-test",
      "blob:component-test",
      "blob:component-test",
    ])
  })

  it("requests file-input focus after retry replaces the error action", async () => {
    // Given: a file-format error whose retry action will disappear
    const focusRequests: string[] = []
    const controller = createDemoVerificationSurfaceController({
      model: createPhotoVerificationModel(dependencies().dependencies),
      onChange: () => {},
      onFocusRequested: (target) => focusRequests.push(target),
      onSettled: () => {},
    })
    await controller.select(photo({ type: "text/plain" }))

    // When: retry transitions away from the error state
    controller.retry()

    // Then: focus is explicitly routed to the usable file input, not the removed retry button
    expect(controller.state().kind).toBe("retry")
    expect(focusRequests).toEqual(["file-input"])
  })

  it("uses the full delay normally and one RAF boundary under reduced motion", () => {
    // Given: deterministic timers, frames, and a motion-preference query
    const callbacks = new Map<number, () => void>()
    const frames = new Map<number, () => void>()
    const delays: number[] = []
    let nextHandle = 0
    let reducedMotion = false
    const scheduler = createMotionAwareVerificationScheduler({
      cancelAnimationFrame: (handle) => frames.delete(handle),
      clearTimeout: (handle) => callbacks.delete(handle),
      prefersReducedMotion: () => reducedMotion,
      requestAnimationFrame: (callback) => {
        nextHandle += 1
        frames.set(nextHandle, callback)
        return nextHandle
      },
      setTimeout: (callback, delayMs) => {
        nextHandle += 1
        callbacks.set(nextHandle, callback)
        delays.push(delayMs)
        return nextHandle
      },
    })
    const completed: string[] = []

    // When: normal motion schedules a photo check
    const normalHandle = scheduler.schedule(1_000, () => completed.push("normal"))
    callbacks.get(normalHandle)?.()

    // Then: normal motion holds the checking state for the model-provided second
    expect(delays).toEqual([1_000])
    expect(completed).toEqual(["normal"])

    // When: the preference changes to reduced motion before the next check
    reducedMotion = true
    const reducedHandle = scheduler.schedule(1_000, () => completed.push("reduced"))
    callbacks.get(reducedHandle)?.()

    // Then: reduced motion skips transform delay but waits through a visible RAF boundary
    expect(delays).toEqual([1_000, 0])
    expect(completed).toEqual(["normal"])
    const frame = [...frames.values()][0]
    if (frame === undefined) throw new TypeError("Expected the reduced-motion frame callback")
    frame()
    expect(completed).toEqual(["normal", "reduced"])
  })

  it("cancels a reduced-motion RAF even when a stale callback is invoked", () => {
    // Given: a reduced-motion check that has reached its RAF boundary
    const callbacks = new Map<number, () => void>()
    const frames = new Map<number, () => void>()
    let nextHandle = 0
    const scheduler = createMotionAwareVerificationScheduler({
      cancelAnimationFrame: (handle) => frames.delete(handle),
      clearTimeout: (handle) => callbacks.delete(handle),
      prefersReducedMotion: () => true,
      requestAnimationFrame: (callback) => {
        nextHandle += 1
        frames.set(nextHandle, callback)
        return nextHandle
      },
      setTimeout: (callback) => {
        nextHandle += 1
        callbacks.set(nextHandle, callback)
        return nextHandle
      },
    })
    let completionCount = 0
    const handle = scheduler.schedule(1_000, () => {
      completionCount += 1
    })
    callbacks.get(handle)?.()
    const staleFrame = [...frames.values()][0]
    if (staleFrame === undefined) throw new TypeError("Expected the pending reduced-motion frame")

    // When: reset or unmount cancels the pending check before the browser delivers its frame
    scheduler.cancel(handle)
    staleFrame()

    // Then: a stale frame cannot complete or revive the cancelled check
    expect(completionCount).toBe(0)
    expect(frames).toHaveLength(0)
  })

  it("renders untrusted goal and file names as text instead of executable markup", () => {
    // Given: hostile text supplied through the public goal and staged-file boundaries
    const html = render(
      {
        attempt: 1,
        file: photo({ name: "<img src=x onerror=alert(1)>.png" }),
        kind: "preview",
        previewUrl: "blob:prompt-injection",
      },
      "<script>alert(1)</script>",
    )

    // When: the state is rendered on the server
    const hasExecutableTag = /<script>|<img src=x/.test(html)

    // Then: React escapes the untrusted values in the accessible surface
    expect(hasExecutableTag).toBe(false)
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;.png")
  })

  it.skipIf(process.env["WRITE_TASK_08_EVIDENCE"] !== "true")(
    "renders every staged component state into the manual inspection artifact",
    async () => {
      // Given: every independently renderable state of the leaf surface
      const states = {
        checking: {
          attempt: 1,
          file: photo({ name: "checking.png" }),
          kind: "checking",
          previewUrl: "blob:checking",
        },
        error: { attempt: 1, error: "non-image", kind: "error" },
        idle: { attempt: 0, kind: "idle" },
        preview: {
          attempt: 1,
          file: photo({ name: "preview.png" }),
          kind: "preview",
          previewUrl: "blob:preview",
        },
        retry: { attempt: 2, kind: "retry" },
        success: { attempt: 1, kind: "success" },
      } satisfies Record<string, PhotoVerificationState<PhotoVerificationError>>
      const rendered = Object.fromEntries(
        Object.entries(states).map(([name, state]) => [name, render(state)]),
      )
      const metrics = Object.fromEntries(
        Object.entries(rendered).map(([name, html]) => {
          const hasStartAction = /data-verification-action="start"/.test(html)
          return [
            name,
            {
              hasFileInput: /type="file"/.test(html),
              hasLiveRegion: /aria-live="(?:assertive|polite)"/.test(html),
              hasSettlementAction: /data-verification-action="settle"/.test(html),
              hasTruthfulNote: html.includes("파일 형식과 미리보기만 확인하는 데모예요"),
              startActionDisabled: hasStartAction
                ? /data-verification-action="start" disabled=""/.test(html)
                : null,
              startActionPresent: hasStartAction,
            },
          ]
        }),
      )
      const evidenceDir = path.resolve(import.meta.dirname, "../../../../.omo/evidence/task-08")

      // When: the states are rendered on the server with no browser harness dependency
      await mkdir(evidenceDir, { recursive: true })
      await writeFile(
        path.join(evidenceDir, "task-08-component-states.html"),
        `<!doctype html><html lang="ko"><body>${Object.entries(rendered)
          .map(([name, html]) => `<section data-state="${name}">${html}</section>`)
          .join("")}</body></html>`,
        "utf8",
      )
      await writeFile(
        path.join(evidenceDir, "task-08-component-states.json"),
        `${JSON.stringify(metrics, null, 2)}\n`,
        "utf8",
      )

      // Then: each state records accessible labels, live feedback, and settlement availability
      expect(Object.keys(metrics)).toHaveLength(6)
      expect(metrics["idle"]?.startActionDisabled).toBe(true)
      expect(metrics["success"]?.hasSettlementAction).toBe(true)
      expect(metrics["checking"]?.hasTruthfulNote).toBe(true)
    },
  )
})
