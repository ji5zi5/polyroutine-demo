"use client"

import { useEffect, useState } from "react"
import { ApiClientError, ApiNetworkError, createGoal, getToday } from "../lib/api"
import type { Account, DailyResult, Goal } from "../lib/contracts"
import { getCachedGoals, rememberGoal } from "../lib/goal-cache"
import { AccountActions } from "./account-actions"
import { DailyResultPanel } from "./daily-result-panel"
import { EvidenceCapturePanel } from "./evidence-capture-panel"
import { GoalPanel } from "./goal-panel"
import { Notice } from "./notice"
import { PredictionPanel } from "./prediction-panel"
import { TodayTimeline } from "./today-timeline"

type DailyDashboardProps = {
  readonly account: Account
  readonly onDelete: () => Promise<void>
  readonly onLogout: () => Promise<void>
}

function goalErrorMessage(error: ApiClientError | ApiNetworkError): string {
  if (error instanceof ApiNetworkError) {
    return "연결이 끊겼어요. 연결한 뒤 오늘 상태를 다시 확인해요."
  }
  if (error.code === "DAILY_GOAL_EXISTS") {
    return "오늘 목표가 이미 있어요. 오늘 상태를 새로고침해요."
  }
  return "목표를 저장하지 못했어요. 입력을 확인한 뒤 다시 시도해요."
}

export function DailyDashboard({ account, onDelete, onLogout }: DailyDashboardProps) {
  const [goal, setGoal] = useState<Goal | null>(null)
  const [result, setResult] = useState<DailyResult | null>(null)
  const [historicalGoal, setHistoricalGoal] = useState<Goal | null>(null)
  const [goalLoaded, setGoalLoaded] = useState(false)
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine)
  const [goalBusy, setGoalBusy] = useState(false)
  const [goalError, setGoalError] = useState<string | null>(null)
  const [confirmedCount, setConfirmedCount] = useState(0)
  const [refreshVersion, setRefreshVersion] = useState(0)

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
    setGoalError(null)
    void getToday(account.subjectKey)
      .then((today) => {
        if (!active) return
        setGoal(today.goal)
        setResult(today.result)
        if (today.goal !== null) rememberGoal(account.subjectKey, today.goal)
        setHistoricalGoal(
          today.result === null
            ? (cachedGoals.find(({ id }) => id !== today.goal?.id) ?? null)
            : null,
        )
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
  }, [account.subjectKey, online, refreshVersion])

  const refreshToday = (): void => setRefreshVersion((version) => version + 1)

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

  return (
    <main className="routineShell">
      <header className="appHeader">
        <div className="stackCompact">
          <p className="productName">폴리루틴 · 오늘</p>
          <h1>오늘의 루틴</h1>
          <p className="lead">목표 하나와 익명 의견을 서버가 확인한 상태 그대로 보여줘요.</p>
        </div>
        <AccountActions online={online} onDelete={onDelete} onLogout={onLogout} />
      </header>

      {online ? null : (
        <Notice announce kind="info">
          오프라인이에요. 확인된 기록은 읽을 수 있고, 연결되면 오늘 상태를 다시 확인해요.
        </Notice>
      )}

      <div className="routineGrid">
        <aside className="timelineRail">
          <TodayTimeline
            goalState={goal?.state ?? null}
            priorResultAvailable={result !== null && result.goal.id !== goal?.id}
          />
        </aside>
        <div className="routineMain">
          {goalLoaded ? (
            <GoalPanel
              busy={goalBusy}
              error={goalError}
              goal={goal}
              historicalGoal={result === null ? historicalGoal : null}
              online={online}
              onCreate={handleCreate}
            />
          ) : (
            <section className="surfacePanel" aria-busy="true">
              <p>서버에서 오늘 상태를 확인하고 있어요.</p>
            </section>
          )}
          {result === null ? null : (
            <DailyResultPanel
              busy={!goalLoaded}
              currentGoal={goal}
              online={online}
              onRefresh={refreshToday}
              result={result}
            />
          )}
          <PredictionPanel
            account={account}
            confirmedCount={confirmedCount}
            online={online}
            onConfirmed={() => setConfirmedCount((count) => count + 1)}
          />
          {goal === null ? null : (
            <EvidenceCapturePanel
              account={account}
              goal={goal}
              online={online}
              onGoalRefresh={refreshToday}
            />
          )}
        </div>
      </div>
    </main>
  )
}
