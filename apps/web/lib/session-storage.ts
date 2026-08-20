import { ZodError } from "zod"
import { type Account, accountSchema } from "./contracts"

const SESSION_KEY = "poly-routine-session:v1"
const SESSION_CHANGE_EVENT = "poly-routine-session-change"

function idempotencyStorageKey(
  kind: "exposure" | "vote",
  subjectKey: string,
  goalId: string,
): string {
  return `poly-routine-${kind}:v1:${subjectKey}:${goalId}`
}

export function getStoredAccountSnapshot(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(SESSION_KEY)
}

export function getServerStoredAccountSnapshot(): null {
  return null
}

export function parseStoredAccountSnapshot(value: string | null): Account | null {
  if (value === null) return null
  try {
    return accountSchema.parse(JSON.parse(value))
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) return null
    throw error
  }
}

export function subscribeStoredAccount(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent): void => {
    if (event.key === SESSION_KEY) onStoreChange()
  }
  const handleLocalChange = (): void => onStoreChange()
  window.addEventListener("storage", handleStorage)
  window.addEventListener(SESSION_CHANGE_EVENT, handleLocalChange)
  return () => {
    window.removeEventListener("storage", handleStorage)
    window.removeEventListener(SESSION_CHANGE_EVENT, handleLocalChange)
  }
}

function announceSessionChange(): void {
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT))
}

export function storeAccount(account: Account): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(account))
  announceSessionChange()
}

export function clearStoredAccount(): void {
  localStorage.removeItem(SESSION_KEY)
  announceSessionChange()
}

export function getOrCreateIdempotencyKey(
  kind: "exposure" | "vote",
  subjectKey: string,
  goalId: string,
): string {
  const storageKey = idempotencyStorageKey(kind, subjectKey, goalId)
  const existing = localStorage.getItem(storageKey)
  if (existing !== null) return existing
  const created = crypto.randomUUID()
  localStorage.setItem(storageKey, created)
  return created
}

export function clearIdempotencyKey(
  kind: "exposure" | "vote",
  subjectKey: string,
  goalId: string,
): void {
  localStorage.removeItem(idempotencyStorageKey(kind, subjectKey, goalId))
}
