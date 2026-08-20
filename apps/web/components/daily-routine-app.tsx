"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import { deleteAccount, logout } from "../lib/api"
import {
  clearStoredAccount,
  getServerStoredAccountSnapshot,
  getStoredAccountSnapshot,
  parseStoredAccountSnapshot,
  storeAccount,
  subscribeStoredAccount,
} from "../lib/session-storage"
import { AccountGate } from "./account-gate"
import { DailyDashboard } from "./daily-dashboard"

export function DailyRoutineApp() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js")
  }, [])

  const storedAccount = useSyncExternalStore(
    subscribeStoredAccount,
    getStoredAccountSnapshot,
    getServerStoredAccountSnapshot,
  )
  const account = useMemo(() => parseStoredAccountSnapshot(storedAccount), [storedAccount])

  if (account === null) return <AccountGate onAuthenticated={storeAccount} />

  return (
    <DailyDashboard
      account={account}
      onDelete={async () => {
        await deleteAccount(account)
        clearStoredAccount()
      }}
      onLogout={async () => {
        await logout(account)
        clearStoredAccount()
      }}
    />
  )
}
