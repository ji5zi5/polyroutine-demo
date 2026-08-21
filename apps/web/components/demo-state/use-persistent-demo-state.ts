"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  createInitialDemoState,
  type DemoAction,
  type DemoDependencies,
  type DemoState,
  reduceDemoState,
} from "../../lib/demo-state"
import {
  createDemoPersistenceSnapshot,
  type DemoPersistenceSnapshot,
  hydrateDemoState,
  resetDemoState,
  saveDemoState,
} from "../../lib/demo-state/persistence"

type PersistenceStatus = "ready" | "storage_error"

type DeviceProfileInput = Readonly<{
  email: string
  nickname?: string
}>

export type PersistentDemoState = Readonly<{
  authenticate: (input: DeviceProfileInput) => void
  dispatch: (action: DemoAction) => void
  hydrated: boolean
  logout: () => void
  now: Date | null
  persistenceStatus: PersistenceStatus
  reset: () => void
  snapshot: DemoPersistenceSnapshot | null
  state: DemoState | null
}>

function browserNow(): Date {
  const value = new URLSearchParams(window.location.search).get("demoNow")
  if (value === null) return new Date()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function browserDependencies(baseNow: Date): DemoDependencies {
  const idPrefix = new URLSearchParams(window.location.search).get("demoIdPrefix")
  let idIndex = 0
  let timeIndex = 0
  return {
    createId: () => {
      idIndex += 1
      return idPrefix === null
        ? `device-${window.crypto.randomUUID()}`
        : `device-${idPrefix.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40) || "test"}-${idIndex}`
    },
    now: () => {
      const timestamp = new Date(baseNow.getTime() + timeIndex)
      timeIndex += 1
      return timestamp
    },
  }
}

function createBlankSnapshot(dependencies: DemoDependencies): DemoPersistenceSnapshot {
  const initial = createInitialDemoState(dependencies)
  const blank = reduceDemoState(initial, { titles: [], type: "replace_goals" }, dependencies)
  return createDemoPersistenceSnapshot(false, "", blank)
}

export function usePersistentDemoState(): PersistentDemoState {
  const dependenciesRef = useRef<DemoDependencies | null>(null)
  const snapshotRef = useRef<DemoPersistenceSnapshot | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [now, setNow] = useState<Date | null>(null)
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>("ready")
  const [snapshot, setSnapshot] = useState<DemoPersistenceSnapshot | null>(null)

  const commit = useCallback((next: DemoPersistenceSnapshot): void => {
    const result = saveDemoState(window.localStorage, next)
    snapshotRef.current = next
    setSnapshot(next)
    setPersistenceStatus(result.kind === "storage_error" ? "storage_error" : "ready")
  }, [])

  useEffect(() => {
    const currentNow = browserNow()
    const dependencies = browserDependencies(currentNow)
    dependenciesRef.current = dependencies
    const result = hydrateDemoState(window.localStorage, () => createBlankSnapshot(dependencies))
    snapshotRef.current = result.snapshot
    setSnapshot(result.snapshot)
    setPersistenceStatus(result.kind === "storage_error" ? "storage_error" : "ready")
    setNow(currentNow)
    setHydrated(true)
  }, [])

  const dispatch = useCallback(
    (action: DemoAction): void => {
      const dependencies = dependenciesRef.current
      const current = snapshotRef.current
      if (dependencies === null || current === null) return
      commit({ ...current, state: reduceDemoState(current.state, action, dependencies) })
    },
    [commit],
  )

  const authenticate = useCallback(
    ({ email, nickname }: DeviceProfileInput): void => {
      const trimmedEmail = email.trim()
      const current = snapshotRef.current
      const dependencies = dependenciesRef.current
      if (trimmedEmail === "" || current === null || dependencies === null) return
      if (nickname === undefined) {
        commit({
          ...current,
          authenticated: true,
          email: current.email === "" ? trimmedEmail : current.email,
        })
        return
      }
      const state = reduceDemoState(
        current.state,
        { nickname: nickname.trim(), type: "update_profile" },
        dependencies,
      )
      commit({ ...current, authenticated: true, email: trimmedEmail, state })
    },
    [commit],
  )

  const logout = useCallback((): void => {
    const current = snapshotRef.current
    if (current !== null) commit({ ...current, authenticated: false })
  }, [commit])

  const reset = useCallback((): void => {
    const dependencies = dependenciesRef.current
    if (dependencies === null) return
    const result = resetDemoState(window.localStorage)
    setPersistenceStatus(result.kind === "storage_error" ? "storage_error" : "ready")
    const blank = createBlankSnapshot(dependencies)
    snapshotRef.current = blank
    setSnapshot(blank)
  }, [])

  return {
    authenticate,
    dispatch,
    hydrated,
    logout,
    now,
    persistenceStatus,
    reset,
    snapshot,
    state: snapshot?.state ?? null,
  }
}
