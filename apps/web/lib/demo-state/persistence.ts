import { z } from "zod"
import type { DemoState } from "./schema"
import { demoStateSchema } from "./schema"

export const DEMO_STATE_STORAGE_KEY = "poly-routine-demo-state:v1"
const MAX_PERSISTED_CHARACTERS = 1_000_000
const versionFieldSchema = z.object({ version: z.unknown() })

export const demoPersistenceSchema = z
  .object({
    authenticated: z.boolean(),
    email: z.string().max(254),
    state: demoStateSchema,
    version: z.literal(1),
  })
  .readonly()

export type DemoPersistenceSnapshot = z.infer<typeof demoPersistenceSchema>

export interface DemoStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

type PersistenceOperation = "read" | "remove" | "write"

export type PersistenceFailure<Operation extends PersistenceOperation = PersistenceOperation> =
  Readonly<{
    errorName: string
    kind: "storage_error"
    operation: Operation
  }>

export type SaveDemoStateResult =
  | Readonly<{ kind: "invalid"; reason: "schema_mismatch" }>
  | Readonly<{ kind: "saved"; snapshot: DemoPersistenceSnapshot }>
  | PersistenceFailure<"write">

export type ResetDemoStateResult = Readonly<{ kind: "reset" }> | PersistenceFailure<"remove">

export type HydrateDemoStateResult =
  | Readonly<{ kind: "hydrated"; snapshot: DemoPersistenceSnapshot }>
  | Readonly<{ kind: "initial"; reason: "empty"; snapshot: DemoPersistenceSnapshot }>
  | Readonly<{
      kind: "recovered"
      reason: "corrupt_json" | "schema_mismatch" | "too_large" | "unknown_version"
      reset: ResetDemoStateResult
      snapshot: DemoPersistenceSnapshot
    }>
  | Readonly<{
      errorName: string
      kind: "storage_error"
      operation: "read"
      snapshot: DemoPersistenceSnapshot
    }>

export function saveDemoState(storage: DemoStorage, input: unknown): SaveDemoStateResult {
  const parsed = demoPersistenceSchema.safeParse(input)
  if (!parsed.success) return { kind: "invalid", reason: "schema_mismatch" }
  try {
    storage.setItem(DEMO_STATE_STORAGE_KEY, JSON.stringify(parsed.data))
    return { kind: "saved", snapshot: parsed.data }
  } catch (error) {
    return persistenceFailure("write", error)
  }
}

export function hydrateDemoState(
  storage: DemoStorage,
  createInitialSnapshot: () => DemoPersistenceSnapshot,
): HydrateDemoStateResult {
  const initial = demoPersistenceSchema.parse(createInitialSnapshot())
  let raw: string | null
  try {
    raw = storage.getItem(DEMO_STATE_STORAGE_KEY)
  } catch (error) {
    const failure = persistenceFailure("read", error)
    return { ...failure, snapshot: initial }
  }
  if (raw === null) return { kind: "initial", reason: "empty", snapshot: initial }
  if (raw.length > MAX_PERSISTED_CHARACTERS) {
    return recoverInitialState(storage, initial, "too_large")
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch (error) {
    if (error instanceof SyntaxError) return recoverInitialState(storage, initial, "corrupt_json")
    throw error
  }
  const versionField = versionFieldSchema.safeParse(decoded)
  if (versionField.success && versionField.data.version !== 1) {
    return recoverInitialState(storage, initial, "unknown_version")
  }
  const parsed = demoPersistenceSchema.safeParse(decoded)
  if (!parsed.success) return recoverInitialState(storage, initial, "schema_mismatch")
  return { kind: "hydrated", snapshot: parsed.data }
}

export function resetDemoState(storage: DemoStorage): ResetDemoStateResult {
  try {
    storage.removeItem(DEMO_STATE_STORAGE_KEY)
    return { kind: "reset" }
  } catch (error) {
    return persistenceFailure("remove", error)
  }
}

export function createDemoPersistenceSnapshot(
  authenticated: boolean,
  email: string,
  state: DemoState,
): DemoPersistenceSnapshot {
  return demoPersistenceSchema.parse({ authenticated, email, state, version: 1 })
}

function persistenceFailure<Operation extends PersistenceOperation>(
  operation: Operation,
  error: unknown,
): PersistenceFailure<Operation> {
  return {
    errorName: error instanceof Error ? error.name : "UnknownThrownValue",
    kind: "storage_error",
    operation,
  }
}

function recoverInitialState(
  storage: DemoStorage,
  snapshot: DemoPersistenceSnapshot,
  reason: Extract<HydrateDemoStateResult, { kind: "recovered" }>["reason"],
): HydrateDemoStateResult {
  return { kind: "recovered", reason, reset: resetDemoState(storage), snapshot }
}
