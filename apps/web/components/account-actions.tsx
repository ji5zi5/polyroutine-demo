"use client"

import { useState } from "react"
import { ApiClientError, ApiNetworkError } from "../lib/api"
import { Notice } from "./notice"

type AccountActionsProps = {
  readonly online: boolean
  readonly onDelete: () => Promise<void>
  readonly onLogout: () => Promise<void>
}

type AccountAction = "delete" | "logout"

export function AccountActions({ online, onDelete, onLogout }: AccountActionsProps) {
  const [confirmingDeletion, setConfirmingDeletion] = useState(false)
  const [busyAction, setBusyAction] = useState<AccountAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runLogout = async (): Promise<void> => {
    if (!online) return
    setBusyAction("logout")
    setError(null)
    try {
      await onLogout()
    } catch (caught) {
      if (caught instanceof ApiClientError || caught instanceof ApiNetworkError) {
        setError("로그아웃을 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해요.")
        return
      }
      throw caught
    } finally {
      setBusyAction(null)
    }
  }

  const runDelete = async (): Promise<void> => {
    if (!online) return
    setBusyAction("delete")
    setError(null)
    try {
      await onDelete()
    } catch (caught) {
      if (caught instanceof ApiClientError || caught instanceof ApiNetworkError) {
        setError("계정 삭제를 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해요.")
        return
      }
      throw caught
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="accountActions">
      <div aria-label="계정 관리" className="buttonCluster" role="group">
        <button
          className="buttonQuiet"
          disabled={!online || busyAction !== null}
          onClick={() => void runLogout()}
          type="button"
        >
          {busyAction === "logout" ? "로그아웃 확인 중" : online ? "로그아웃" : "연결 후 로그아웃"}
        </button>
        <button
          className="buttonDangerGhost"
          disabled={!online || busyAction !== null}
          onClick={() => setConfirmingDeletion(true)}
          type="button"
        >
          {online ? "계정 삭제" : "연결 후 계정 삭제"}
        </button>
      </div>
      {confirmingDeletion ? (
        <section className="deleteConfirmation" aria-labelledby="delete-confirmation-heading">
          <h2 id="delete-confirmation-heading">계정과 기록을 삭제할까요?</h2>
          <p>진행 중인 오늘 목표는 취소되고, 다시 로그인할 수 없어요.</p>
          <div className="buttonCluster">
            <button
              className="buttonDanger"
              disabled={busyAction !== null}
              onClick={() => void runDelete()}
              type="button"
            >
              {busyAction === "delete" ? "계정 삭제 중" : "계정과 기록 삭제"}
            </button>
            <button
              className="buttonQuiet"
              disabled={busyAction !== null}
              onClick={() => setConfirmingDeletion(false)}
              type="button"
            >
              계속 사용
            </button>
          </div>
        </section>
      ) : null}
      {error === null ? null : (
        <Notice announce kind="error">
          {error}
        </Notice>
      )}
    </div>
  )
}
