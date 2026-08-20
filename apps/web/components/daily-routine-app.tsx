"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import { deleteAccount, logout } from "../lib/api"
import type { Account } from "../lib/contracts"
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

type DailyRoutineAppProps = {
  readonly accountActionsVisible?: boolean
  readonly initialAccount?: Account
  readonly initialConfirmedCount?: number
}

export function DailyRoutineApp({
  accountActionsVisible = true,
  initialAccount,
  initialConfirmedCount = 0,
}: DailyRoutineAppProps = {}) {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js")
  }, [])

  const storedAccount = useSyncExternalStore(
    subscribeStoredAccount,
    getStoredAccountSnapshot,
    getServerStoredAccountSnapshot,
  )
  const account = useMemo(
    () => initialAccount ?? parseStoredAccountSnapshot(storedAccount),
    [initialAccount, storedAccount],
  )

  if (account === null) return <AccountGate onAuthenticated={storeAccount} />

  return (
    <DailyDashboard
      account={account}
      accountActionsVisible={accountActionsVisible}
      initialConfirmedCount={initialConfirmedCount}
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
