"use client"

import { useState } from "react"
import type { GoalAnalysisState } from "../lib/demo-goal-analysis/client/use-goal-analysis"
import { GoalAnalysisRequestSchema } from "../lib/demo-goal-analysis/contract"
import { analyzeGoalsFallback } from "../lib/demo-goal-analysis/fallback"
import type { ValidAuthInput } from "../lib/demo-my/auth-input"
import { selectMySummary } from "../lib/demo-my/my-view-model"
import {
  type DemoAction,
  type DemoState,
  type MarketPosition,
  type MarketRoundHistory,
  selectMarketRoundHistory,
  selectPendingMarketPositions,
} from "../lib/demo-state"
import { GoalAnalysisPanel } from "./demo-goal-analysis/goal-analysis-panel"
import { AuthGate } from "./demo-my/auth-gate"
import { MySurface } from "./demo-my/my-surface"
import { DemoPointsTab } from "./demo-points/demo-points-tab"
import { demoPredictionOutcomes, predictionCards } from "./demo-prediction-cards"
import { usePersistentDemoState } from "./demo-state/use-persistent-demo-state"
import { DemoVerificationSurface } from "./demo-verification/demo-verification-surface"
import { PredictionCard } from "./prediction-card"

type DemoStep = "goal" | "listed" | "points" | "predict" | "profile" | "settle" | "verify"
type DemoTab = "goal" | "points" | "predict" | "profile"

const demoNavItems = [
  { icon: "M5 12h14M12 5l7 7-7 7", label: "예측", tab: "predict" },
  { icon: "M6 4h12v16H6zM9 9h6M9 13h6", label: "내 목표", tab: "goal" },
  { icon: "M4 7h16v12H4zM4 10h16M8 15h4", label: "포인트", tab: "points" },
  { icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21a7 7 0 0 1 14 0", label: "MY", tab: "profile" },
] as const satisfies readonly { icon: string; label: string; tab: DemoTab }[]

function DemoTopBar({ label }: { readonly label: string }) {
  return (
    <header className="demoTopBar">
      <span className="demoBrand">폴리루틴</span>
      <span className="demoStepLabel">{label}</span>
    </header>
  )
}

function DemoBottomNav({
  current,
  onNavigate,
}: {
  readonly current: DemoTab
  readonly onNavigate: (tab: DemoTab) => void
}) {
  return (
    <nav aria-label="하단 메뉴" className="demoNav">
      {demoNavItems.map((item) => (
        <button
          aria-current={current === item.tab ? "page" : undefined}
          key={item.tab}
          onClick={() => onNavigate(item.tab)}
          type="button"
        >
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <path
              d={item.icon}
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

type PointsScreenProps = Readonly<{
  now: Date
  onNavigate: (tab: DemoTab) => void
  pendingPositions: readonly MarketPosition[]
  rounds: readonly MarketRoundHistory[]
  state: DemoState
  onDispatch: (action: DemoAction) => void
}>

function PointsScreen({
  now,
  onDispatch,
  onNavigate,
  pendingPositions,
  rounds,
  state,
}: PointsScreenProps) {
  return (
    <main className="demoViewport" key="points">
      <DemoTopBar label="포인트" />
      <section className="demoScreen demoScrollableScreen">
        <div className="demoHeading">
          <h1>내 포인트</h1>
        </div>
        <DemoPointsTab
          now={now}
          onDispatch={onDispatch}
          pendingPositions={pendingPositions}
          rounds={rounds}
          state={state}
        />
      </section>
      <DemoBottomNav current="points" onNavigate={onNavigate} />
    </main>
  )
}

export function PrototypeDemo() {
  const demo = usePersistentDemoState()
  const [step, setStep] = useState<DemoStep>("predict")
  const [cardIndex, setCardIndex] = useState(0)
  const [goalText, setGoalText] = useState("")
  const [goalAnalysisState, setGoalAnalysisState] = useState<GoalAnalysisState>({ kind: "idle" })
  const [marketMessage, setMarketMessage] = useState("")

  const snapshot = demo.snapshot
  const demoState = demo.state
  const authenticated = snapshot?.authenticated ?? false
  const email = snapshot?.email ?? ""
  const goalItems = demoState?.goals.map((goal) => goal.title) ?? []
  const nickname = demoState?.profile.nickname ?? "폴리 유저"
  const points = demoState?.balance ?? 0
  const pendingPositions = demoState === null ? [] : selectPendingMarketPositions(demoState)
  const marketRounds = demoState === null ? [] : selectMarketRoundHistory(demoState)
  const addGoalItem = (): void => {
    const nextGoal = goalText.trim()
    if (nextGoal === "" || (!goalItems.includes(nextGoal) && goalItems.length >= 5)) return

    const nextGoals = goalItems.includes(nextGoal) ? goalItems : [...goalItems, nextGoal]
    demo.dispatch({ titles: nextGoals, type: "replace_goals" })
    setGoalText("")
    setGoalAnalysisState({ kind: "idle" })
  }

  const resetRoutineView = (): void => {
    setCardIndex(0)
    setGoalText("")
    setGoalAnalysisState({ kind: "idle" })
    setMarketMessage("")
    setStep("predict")
  }

  const navigate = (tab: DemoTab): void => {
    setGoalAnalysisState({ kind: "idle" })
    if (tab === "predict") {
      setStep("predict")
      return
    }
    if (tab === "points" || tab === "profile") {
      setStep(tab)
      return
    }
    setStep(goalItems.length > 0 ? "listed" : "goal")
  }

  const pendingGoal = goalText.trim()
  const analysisGoals =
    pendingGoal !== "" && !goalItems.includes(pendingGoal) && goalItems.length < 5
      ? [...goalItems, pendingGoal]
      : goalItems
  const analysisResult =
    goalAnalysisState.kind === "success" || goalAnalysisState.kind === "fallback"
      ? goalAnalysisState.value
      : null
  const analyzing = goalAnalysisState.kind === "loading"

  if (!demo.hydrated || snapshot === null || demoState === null) {
    return (
      <main aria-busy="true" className="demoViewport demoLoginViewport">
        <span aria-live="polite" className="ownedRewardsEmpty" role="status">
          데모를 불러오고 있어요
        </span>
      </main>
    )
  }

  if (!authenticated) {
    return (
      <main className="demoViewport demoLoginViewport" key="login">
        <DemoTopBar label="계정" />
        <section className="demoScreen demoLoginScreen">
          <AuthGate
            onAuthenticate={(input: ValidAuthInput) => {
              demo.authenticate(
                input.mode === "signup"
                  ? { email: input.email, nickname: input.nickname }
                  : { email: input.email },
              )
            }}
          />
        </section>
      </main>
    )
  }

  if (step === "predict") {
    const card = predictionCards[cardIndex]
    const nextCard = predictionCards[(cardIndex + 1) % predictionCards.length]
    if (card === undefined || nextCard === undefined) return null
    return (
      <main className="demoViewport" key="predict">
        <DemoTopBar label={`${points.toLocaleString("ko-KR")}P`} />
        <section
          className="demoScreen demoPredictScreen"
          data-card-pool-size={predictionCards.length}
        >
          <div className="demoHeading">
            <h1>가능할지 골라요</h1>
          </div>
          <PredictionCard
            busy={false}
            card={card}
            key={card.goalId}
            nextCard={nextCard}
            onChoice={(choice) => {
              if (points < 100) {
                setMarketMessage(`100P 필요 · 보유 ${points}P · ${100 - points}P 부족`)
                return
              }
              const yesPercent = card.yesPercent ?? 50
              const crowdPercentage = choice === "yes" ? yesPercent : 100 - yesPercent
              const fixtureOutcome = demoPredictionOutcomes[card.goalId]
              if (fixtureOutcome === undefined) return
              demo.dispatch({
                cardId: card.goalId,
                cardLabel: card.tasks?.join(" · ") ?? card.recipe.instructions,
                choice,
                crowdPercentage,
                fixtureOutcome,
                roundId: demoState.round.id,
                stake: 100,
                type: "place_market_position",
              })
              setMarketMessage(`-100P · ${choice === "yes" ? "가능" : "불가능"} 베팅`)
              setCardIndex((current) => (current + 1) % predictionCards.length)
            }}
            onSkip={() => {
              setMarketMessage("")
              setCardIndex((current) => (current + 1) % predictionCards.length)
            }}
            rewardEligible={points >= 100}
          />
          {marketMessage === "" ? null : (
            <p aria-live="polite" className="ownedRewardsEmpty">
              {marketMessage}
            </p>
          )}
        </section>
        <DemoBottomNav current="predict" onNavigate={navigate} />
      </main>
    )
  }

  if (step === "goal") {
    return (
      <main className="demoViewport" key="goal">
        <DemoTopBar label="상장" />
        <section className="demoScreen demoScrollableScreen">
          <div className="demoHeading">
            <h1>내 목표 상장하기</h1>
          </div>
          <div className="formField demoGoalField">
            <label className="formLabel" htmlFor="demo-goal-input">
              오늘의 목표
            </label>
            <div className="goalComposerRow">
              <input
                className="formInput demoGoalInput"
                disabled={analyzing}
                id="demo-goal-input"
                maxLength={120}
                onChange={(event) => {
                  setGoalText(event.target.value)
                  setGoalAnalysisState({ kind: "idle" })
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return
                  event.preventDefault()
                  addGoalItem()
                }}
                placeholder="예: 정보처리기사 3장 요약"
                value={goalText}
              />
              <button
                aria-label="목표 추가"
                className="goalAddButton"
                disabled={goalText.trim() === "" || goalItems.length >= 5 || analyzing}
                onClick={addGoalItem}
                type="button"
              >
                추가
              </button>
            </div>
          </div>
          {goalItems.length > 0 ? (
            <ul aria-label="추가한 목표" className="goalDraftList">
              {goalItems.map((goal) => (
                <li key={goal}>
                  <span className="goalDraftText">{goal}</span>
                  <button
                    aria-label={`${goal} 삭제`}
                    disabled={analyzing}
                    onClick={() => {
                      demo.dispatch({
                        titles: goalItems.filter((item) => item !== goal),
                        type: "replace_goals",
                      })
                      setGoalAnalysisState({ kind: "idle" })
                    }}
                    type="button"
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <GoalAnalysisPanel
            goals={analysisGoals}
            onAnalysisStart={(goals) => {
              demo.dispatch({ titles: goals, type: "replace_goals" })
              setGoalText("")
            }}
            onStateChange={setGoalAnalysisState}
          />
          {analysisResult === null ? null : (
            <div className="demoBottomAction">
              <button
                className="buttonFull demoPrimaryButton"
                onClick={() => setStep("listed")}
                type="button"
              >
                이 목표 상장하기
              </button>
            </div>
          )}
        </section>
        <DemoBottomNav current="goal" onNavigate={navigate} />
      </main>
    )
  }

  if (step === "listed") {
    const listedAnalysis =
      analysisResult ?? analyzeGoalsFallback(GoalAnalysisRequestSchema.parse({ goals: goalItems }))
    return (
      <main className="demoViewport" key="listed">
        <DemoTopBar label="내 목표" />
        <section className="demoScreen">
          <div className="demoHeading">
            <h1>오늘 내 목표</h1>
          </div>
          <section className="listedGoalCard">
            <span className="statusLabel statusReady">상장 완료</span>
            <ul aria-label="오늘의 할 일" className="listedGoalList">
              {goalItems.map((goal, index) => (
                <li key={goal}>
                  <span aria-hidden="true" className="listedGoalIndex">
                    {index + 1}
                  </span>
                  <strong>{goal}</strong>
                </li>
              ))}
            </ul>
            <dl>
              <div>
                <dt>AI 성공 확률</dt>
                <dd>{listedAnalysis.probability}%</dd>
              </div>
              <div>
                <dt>인증 마감</dt>
                <dd>오후 10:00</dd>
              </div>
            </dl>
          </section>
          <div className="demoBottomAction">
            <button
              className="buttonFull demoPrimaryButton"
              onClick={() => setStep("verify")}
              type="button"
            >
              사진 인증하기
            </button>
          </div>
        </section>
        <DemoBottomNav current="goal" onNavigate={navigate} />
      </main>
    )
  }

  if (step === "verify") {
    return (
      <main className="demoViewport" key="verify">
        <DemoTopBar label="인증" />
        <section className="demoScreen demoScrollableScreen" data-verification-scroll-container>
          <div className="demoHeading">
            <h1>사진 인증</h1>
          </div>
          <DemoVerificationSurface
            goal={goalItems.join(" · ")}
            onSettled={() => {
              const firstGoal = demoState.goals[0]
              if (firstGoal !== undefined) {
                demo.dispatch({
                  amount: 200,
                  goalId: firstGoal.id,
                  type: "credit_goal_completion",
                })
              }
              setStep("settle")
            }}
          />
        </section>
        <DemoBottomNav current="goal" onNavigate={navigate} />
      </main>
    )
  }

  if (step === "points") {
    if (demo.now === null) return null
    return (
      <PointsScreen
        key="points"
        now={demo.now}
        onDispatch={demo.dispatch}
        onNavigate={navigate}
        pendingPositions={pendingPositions}
        rounds={marketRounds}
        state={demoState}
      />
    )
  }

  if (step === "profile") {
    const summary = selectMySummary(demoState)
    return (
      <main className="demoViewport" key="profile">
        <DemoTopBar label="MY" />
        <section className="demoScreen demoScrollableScreen">
          <div className="demoHeading">
            <h1>내 정보</h1>
          </div>
          <MySurface
            balance={points}
            email={email}
            nickname={nickname}
            onLogout={() => {
              demo.logout()
              resetRoutineView()
            }}
            onReset={() => {
              demo.reset()
              resetRoutineView()
            }}
            onUpdateNickname={(nextNickname) => {
              demo.dispatch({ nickname: nextNickname, type: "update_profile" })
            }}
            summary={summary}
          />
        </section>
        <DemoBottomNav current="profile" onNavigate={navigate} />
      </main>
    )
  }

  return (
    <main className="demoViewport" key="settle">
      <DemoTopBar label="정산" />
      <section className="demoScreen">
        <div className="demoHeading">
          <h1>오늘의 정산</h1>
        </div>
        <section className="settlementCard">
          <span>획득 포인트</span>
          <strong>+200점</strong>
          <dl>
            <div>
              <dt>기본 포인트</dt>
              <dd>+100점</dd>
            </div>
            <div>
              <dt>반전 가산점 ×2.0</dt>
              <dd>+100점</dd>
            </div>
          </dl>
        </section>
        <div className="demoBottomAction">
          <button
            className="buttonFull buttonQuiet demoPrimaryButton"
            onClick={resetRoutineView}
            type="button"
          >
            처음부터 다시 보기
          </button>
        </div>
      </section>
      <DemoBottomNav current="points" onNavigate={navigate} />
    </main>
  )
}
