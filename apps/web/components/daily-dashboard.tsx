"use client"

import { useEffect, useState } from "react"
import { ApiClientError, ApiNetworkError, createGoal, getToday } from "../lib/api"
import type { Account, Goal } from "../lib/contracts"
import { getCachedGoals, rememberGoal } from "../lib/goal-cache"
import { EvidenceCapturePanel } from "./evidence-capture-panel"
import { GoalPanel } from "./goal-panel"
import { Notice } from "./notice"
import { PredictionPanel } from "./prediction-panel"
import { TodayTimeline } from "./today-timeline"

type DailyDashboardProps = {
  readonly account: Account
  readonly onLogout: () => Promise<void>
}

function goalErrorMessage(error: ApiClientError | ApiNetworkError): string {
  if (error instanceof ApiNetworkError) return "연결이 끊겼습니다. 같은 목표로 다시 확인해 주세요."
  if (error.code === "DAILY_GOAL_EXISTS") return "오늘 목표는 이미 하나 저장되어 있습니다."
  return "목표를 저장하지 못했습니다. 입력과 연결 상태를 확인해 주세요."
}

export function DailyDashboard({ account, onLogout }: DailyDashboardProps) {
  const [goal, setGoal] = useState<Goal | null>(null)
  const [historicalGoal, setHistoricalGoal] = useState<Goal | null>(null)
  const [goalLoaded, setGoalLoaded] = useState(false)
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine)
  const [goalBusy, setGoalBusy] = useState(false)
  const [goalError, setGoalError] = useState<string | null>(null)
  const [confirmedCount, setConfirmedCount] = useState(0)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  useEffect(() => {
    const handleOnline = (): void => setOnline(true)
    const handleOffline = (): void => setOnline(false)
    setOnline(navigator.onLine)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  useEffect(() => {
    let active = true
    const cachedGoals = getCachedGoals(account.subjectKey)
    if (!online) {
      setGoal(null)
      setHistoricalGoal(cachedGoals[0] ?? null)
      setGoalLoaded(true)
      return () => {
        active = false
      }
    }
    setGoalLoaded(false)
    void getToday(account.subjectKey)
      .then((today) => {
        if (!active) return
        setGoal(today)
        if (today !== null) rememberGoal(account.subjectKey, today)
        setHistoricalGoal(cachedGoals.find(({ id }) => id !== today?.id) ?? null)
      })
      .catch((error) => {
        if (error instanceof ApiClientError || error instanceof ApiNetworkError) {
          if (active) {
            setGoal(null)
            setHistoricalGoal(cachedGoals[0] ?? null)
            setGoalError(goalErrorMessage(error))
            if (error instanceof ApiNetworkError) setOnline(false)
          }
          return
        }
        throw error
      })
      .finally(() => {
        if (active) setGoalLoaded(true)
      })
    return () => {
      active = false
    }
  }, [account.subjectKey, online])

  const handleCreate = async (noteLineTarget: number): Promise<void> => {
    if (!online) return
    setGoalBusy(true)
    setGoalError(null)
    try {
      const created = await createGoal(account.subjectKey, noteLineTarget)
      rememberGoal(account.subjectKey, created)
      setGoal(created)
    } catch (error) {
      if (error instanceof ApiClientError || error instanceof ApiNetworkError) {
        setGoalError(goalErrorMessage(error))
        return
      }
      throw error
    } finally {
      setGoalBusy(false)
    }
  }

  const handleLogout = async (): Promise<void> => {
    if (!online) return
    setLogoutError(null)
    try {
      await onLogout()
    } catch (error) {
      if (error instanceof ApiClientError || error instanceof ApiNetworkError) {
        setLogoutError("로그아웃을 확인하지 못했습니다. 연결을 확인해 주세요.")
        return
      }
      throw error
    }
  }

  return (
    <main className="routineShell">
      <header className="appHeader">
        <div className="stackCompact">
          <p className="productName">폴리루틴 · 오늘</p>
          <h1>오늘의 루틴</h1>
          <p className="lead">목표 하나와 익명 의견을 서버 상태 그대로 확인합니다.</p>
        </div>
        <button
          className="buttonQuiet"
          disabled={!online}
          onClick={() => void handleLogout()}
          type="button"
        >
          {online ? "로그아웃" : "연결 후 로그아웃"}
        </button>
      </header>

      {online ? null : (
        <Notice announce kind="info">
          오프라인입니다. 확인된 기록은 읽을 수 있지만 서버 변경은 연결 후 가능합니다.
        </Notice>
      )}

      {logoutError === null ? null : (
        <Notice announce kind="error">
          {logoutError}
        </Notice>
      )}

      <div className="routineGrid">
        <aside className="timelineRail">
          <TodayTimeline goalCreated={goal !== null} predictionStarted={confirmedCount > 0} />
        </aside>
        <div className="routineMain">
          {goalLoaded ? (
            <GoalPanel
              busy={goalBusy}
              error={goalError}
              goal={goal}
              historicalGoal={historicalGoal}
              online={online}
              onCreate={handleCreate}
            />
          ) : (
            <section className="surfacePanel" aria-busy="true">
              <p>서버에서 오늘 목표를 확인하고 있습니다.</p>
            </section>
          )}
          <PredictionPanel
            account={account}
            confirmedCount={confirmedCount}
            online={online}
            onConfirmed={() => setConfirmedCount((count) => count + 1)}
          />
          {goal === null ? null : (
            <EvidenceCapturePanel account={account} goal={goal} online={online} />
          )}
        </div>
      </div>
    </main>
  )
}
