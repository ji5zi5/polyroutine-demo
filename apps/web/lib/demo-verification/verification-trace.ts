import {
  createPhotoVerificationModel,
  MAX_STAGED_PHOTO_BYTES,
  type PhotoVerificationDependencies,
  type StagedPhoto,
} from "./verification-model.js"

type TraceScheduler = {
  readonly cancelCount: () => number
  readonly run: (handle: number) => void
  readonly scheduler: PhotoVerificationDependencies["scheduler"]
}

function photo(overrides: Partial<StagedPhoto> = {}): StagedPhoto {
  return {
    arrayBuffer: async () => new ArrayBuffer(1),
    name: "trace.png",
    size: 1,
    type: "image/png",
    ...overrides,
  }
}

function traceScheduler(): TraceScheduler {
  const callbacks = new Map<number, () => void>()
  const cancelled: number[] = []
  let nextHandle = 0

  return {
    cancelCount: () => cancelled.length,
    run: (handle) => {
      const callback = callbacks.get(handle)
      if (callback === undefined) throw new TypeError("Unknown scheduled verification")
      callback()
    },
    scheduler: {
      cancel: (handle) => cancelled.push(handle),
      schedule: (_delayMs, callback) => {
        nextHandle += 1
        callbacks.set(nextHandle, callback)
        return nextHandle
      },
    },
  }
}

function dependencies(
  readable: boolean,
  scheduler: TraceScheduler,
): {
  readonly dependencies: PhotoVerificationDependencies
  readonly revocationCount: () => number
} {
  const revokedUrls: string[] = []

  return {
    dependencies: {
      createPreviewUrl: () => ({ kind: "created", url: "blob:qa" }),
      readFile: async () =>
        readable ? { bytes: new ArrayBuffer(1), kind: "read" } : { kind: "unreadable" },
      revokePreviewUrl: (url) => revokedUrls.push(url),
      scheduler: scheduler.scheduler,
    },
    revocationCount: () => revokedUrls.length,
  }
}

async function errorRetryTrace(
  file: StagedPhoto,
  readable: boolean,
): Promise<{
  readonly error: string
  readonly revocationCount: number
  readonly states: readonly string[]
}> {
  const scheduler = traceScheduler()
  const harness = dependencies(readable, scheduler)
  const model = createPhotoVerificationModel(harness.dependencies)
  await model.select(file)
  const states = [model.state().kind]
  const result = model.serialize()
  if (result.kind !== "error") throw new TypeError("Expected a file-validation error")
  model.retry()
  states.push(model.state().kind)
  return { error: result.error, revocationCount: harness.revocationCount(), states }
}

async function main(): Promise<void> {
  const validScheduler = traceScheduler()
  const validHarness = dependencies(true, validScheduler)
  const validModel = createPhotoVerificationModel(validHarness.dependencies)
  const validStates = [validModel.state().kind]
  const selection = validModel.select(photo())
  validStates.push(validModel.state().kind)
  await selection
  validStates.push(validModel.state().kind)
  validModel.startChecking()
  validStates.push(validModel.state().kind)
  validScheduler.run(1)
  validStates.push(validModel.state().kind)

  const trace = {
    invalid: {
      oversize: await errorRetryTrace(photo({ size: MAX_STAGED_PHOTO_BYTES + 1 }), true),
      readFailure: await errorRetryTrace(photo(), false),
      zeroSize: await errorRetryTrace(photo({ size: 0 }), true),
    },
    noSemanticOrLivenessClaim: true,
    valid: {
      revocationCount: validHarness.revocationCount(),
      scheduledCompletionCancelCount: validScheduler.cancelCount(),
      states: validStates,
    },
  }

  process.stdout.write(`${JSON.stringify(trace, null, 2)}\n`)
}

await main()
