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

type DailyDashboardProps = {
  readonly account: Account
  readonly accountActionsVisible: boolean
  readonly initialConfirmedCount: number
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

export function DailyDashboard({
  account,
  accountActionsVisible,
  initialConfirmedCount,
  onDelete,
  onLogout,
}: DailyDashboardProps) {
  const [goal, setGoal] = useState<Goal | null>(null)
  const [result, setResult] = useState<DailyResult | null>(null)
  const [historicalGoal, setHistoricalGoal] = useState<Goal | null>(null)
  const [goalLoaded, setGoalLoaded] = useState(false)
  const [online, setOnline] = useState(true)
  const [goalBusy, setGoalBusy] = useState(false)
  const [goalError, setGoalError] = useState<string | null>(null)
  const [confirmedCount, setConfirmedCount] = useState(initialConfirmedCount)
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshVersion is an explicit reload trigger.
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
        <div className="appHeaderTop">
          <p className="productName">폴리루틴</p>
          {accountActionsVisible ? (
            <AccountActions online={online} onDelete={onDelete} onLogout={onLogout} />
          ) : null}
        </div>
        <div className="stackCompact">
          <h1>{result === null ? "오늘 루틴" : "오늘의 선택"}</h1>
          <p className="lead">
            {result === null
              ? "오늘 할 일을 하나씩 끝내요."
              : "카드를 좌우로 넘겨 다른 사람의 루틴을 예상해요."}
          </p>
        </div>
      </header>

      {online ? null : (
        <Notice announce kind="info">
          오프라인이에요. 확인된 기록은 읽을 수 있고, 연결되면 오늘 상태를 다시 확인해요.
        </Notice>
      )}

      <div className="routineMain">
        {result === null ? null : (
          <PredictionPanel
            account={account}
            confirmedCount={confirmedCount}
            online={online}
            onConfirmed={() => setConfirmedCount((count) => count + 1)}
          />
        )}
        {goalLoaded ? (
          result === null ? (
            <GoalPanel
              busy={goalBusy}
              error={goalError}
              goal={goal}
              historicalGoal={historicalGoal}
              online={online}
              onCreate={handleCreate}
            />
          ) : (
            <DailyResultPanel
              busy={!goalLoaded}
              currentGoal={goal}
              online={online}
              onRefresh={refreshToday}
              result={result}
            />
          )
        ) : (
          <section className="surfacePanel" aria-busy="true">
            <p>오늘 루틴을 불러오고 있어요.</p>
          </section>
        )}
        {goal === null ? null : (
          <EvidenceCapturePanel
            account={account}
            goal={goal}
            online={online}
            onGoalRefresh={refreshToday}
          />
        )}
        {result === null ? (
          <PredictionPanel
            account={account}
            confirmedCount={confirmedCount}
            online={online}
            onConfirmed={() => setConfirmedCount((count) => count + 1)}
          />
        ) : null}
      </div>
    </main>
  )
}
