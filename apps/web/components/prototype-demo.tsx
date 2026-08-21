"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { couponCatalog, type RewardProduct } from "../lib/demo-coupons"
import type { GoalAnalysisState } from "../lib/demo-goal-analysis/client/use-goal-analysis"
import { GoalAnalysisRequestSchema } from "../lib/demo-goal-analysis/contract"
import { analyzeGoalsFallback } from "../lib/demo-goal-analysis/fallback"
import {
  type DemoAction,
  type DemoState,
  type MarketPosition,
  type MarketRoundHistory,
  selectMarketRoundHistory,
  selectPendingMarketPositions,
} from "../lib/demo-state"
import { GoalAnalysisPanel } from "./demo-goal-analysis/goal-analysis-panel"
import { DemoPointsTab } from "./demo-points/demo-points-tab"
import { demoPredictionOutcomes, predictionCards } from "./demo-prediction-cards"
import { usePersistentDemoState } from "./demo-state/use-persistent-demo-state"
import { DemoVerificationSurface } from "./demo-verification/demo-verification-surface"
import { PredictionCard } from "./prediction-card"

type RewardItem = RewardProduct
type RewardId = RewardProduct["id"]

function isRewardId(value: string): value is RewardId {
  return couponCatalog.some((reward) => reward.id === value)
}

type DemoStep = "goal" | "listed" | "points" | "predict" | "profile" | "settle" | "verify"
type DemoTab = "goal" | "points" | "predict" | "profile"
type AuthMode = "login" | "signup"

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

function RewardImage({ reward }: { readonly reward: RewardItem }) {
  return (
    <div className="rewardImage">
      <Image alt={reward.name} fill sizes="152px" src={reward.imageSrc} unoptimized />
    </div>
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

function PurchasedRewards({
  purchasedRewardIds,
}: {
  readonly purchasedRewardIds: readonly RewardId[]
}) {
  const purchasedRewards = couponCatalog
    .map((reward) => ({
      count: purchasedRewardIds.filter((id) => id === reward.id).length,
      reward,
    }))
    .filter(({ count }) => count > 0)

  return (
    <section className="ownedRewards">
      <h2>보유 쿠폰</h2>
      {purchasedRewards.length === 0 ? (
        <p className="ownedRewardsEmpty">아직 보유한 쿠폰이 없어요.</p>
      ) : (
        <div className="ownedRewardsList">
          {purchasedRewards.map(({ count, reward }) => (
            <article className="ownedReward" key={reward.id}>
              <RewardImage reward={reward} />
              <div>
                <h3>{reward.name}</h3>
                <span>사용 가능 · {count}개</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function PrototypeDemo() {
  const demo = usePersistentDemoState()
  const loginEmailRef = useRef<HTMLInputElement>(null)
  const nicknameDialogRef = useRef<HTMLDialogElement>(null)
  const resetDialogRef = useRef<HTMLDialogElement>(null)
  const resetTriggerRef = useRef<HTMLButtonElement>(null)
  const [step, setStep] = useState<DemoStep>("predict")
  const [authMode, setAuthMode] = useState<AuthMode>("login")
  const [cardIndex, setCardIndex] = useState(0)
  const [emailDraft, setEmailDraft] = useState("")
  const [goalText, setGoalText] = useState("")
  const [goalAnalysisState, setGoalAnalysisState] = useState<GoalAnalysisState>({ kind: "idle" })
  const [nicknameDraft, setNicknameDraft] = useState("")
  const [password, setPassword] = useState("")
  const [editingNickname, setEditingNickname] = useState(false)
  const [marketMessage, setMarketMessage] = useState("")
  const [resetOpen, setResetOpen] = useState(false)
  const [resetFocusPending, setResetFocusPending] = useState(false)

  const snapshot = demo.snapshot
  const demoState = demo.state
  const authenticated = snapshot?.authenticated ?? false
  const email = snapshot?.email ?? ""
  const goalItems = demoState?.goals.map((goal) => goal.title) ?? []
  const nickname = demoState?.profile.nickname ?? "폴리 유저"
  const points = demoState?.balance ?? 0
  const pendingPositions = demoState === null ? [] : selectPendingMarketPositions(demoState)
  const marketRounds = demoState === null ? [] : selectMarketRoundHistory(demoState)
  const purchasedRewardIds =
    demoState?.coupons
      .map((coupon) => coupon.catalogId)
      .filter((catalogId): catalogId is RewardId => isRewardId(catalogId)) ?? []

  useEffect(() => {
    const dialog = nicknameDialogRef.current
    if (editingNickname && dialog !== null && !dialog.open) dialog.showModal()
  }, [editingNickname])

  useEffect(() => {
    const dialog = resetDialogRef.current
    if (resetOpen && dialog !== null && !dialog.open) dialog.showModal()
  }, [resetOpen])

  useEffect(() => {
    if (!resetFocusPending || authenticated) return
    loginEmailRef.current?.focus()
    setResetFocusPending(false)
  }, [authenticated, resetFocusPending])

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
        <DemoTopBar label={authMode === "login" ? "로그인" : "회원가입"} />
        <section className="demoScreen demoLoginScreen">
          <div className="demoLoginHero">
            <h1>{authMode === "login" ? "오늘도 가볍게 시작해요" : "처음 오셨나요?"}</h1>
            <p>
              {authMode === "login" ? "목표를 예측하고 기록해요." : "계정을 만들고 바로 시작해요."}
            </p>
          </div>
          <form
            className="demoLoginForm"
            onSubmit={(event) => {
              event.preventDefault()
              if (emailDraft.trim() === "" || password === "") return
              if (authMode === "signup") {
                const nextNickname = nicknameDraft.trim()
                if (nextNickname === "") return
                demo.authenticate({ email: emailDraft, nickname: nextNickname })
              } else {
                demo.authenticate({ email: emailDraft })
              }
              setPassword("")
            }}
          >
            {authMode === "signup" ? (
              <label className="formField">
                <span className="formLabel">닉네임</span>
                <input
                  autoComplete="nickname"
                  className="formInput demoGoalInput"
                  maxLength={16}
                  onChange={(event) => setNicknameDraft(event.target.value)}
                  placeholder="닉네임 입력"
                  value={nicknameDraft}
                />
              </label>
            ) : null}
            <label className="formField">
              <span className="formLabel">이메일</span>
              <input
                autoComplete="email"
                className="formInput demoGoalInput"
                maxLength={254}
                onChange={(event) => setEmailDraft(event.target.value)}
                placeholder="이메일 입력"
                ref={loginEmailRef}
                type="email"
                value={emailDraft}
              />
            </label>
            <label className="formField">
              <span className="formLabel">비밀번호</span>
              <input
                autoComplete="current-password"
                className="formInput demoGoalInput"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="비밀번호 입력"
                type="password"
                value={password}
              />
            </label>
            <button
              className="buttonFull demoPrimaryButton"
              disabled={
                emailDraft.trim() === "" ||
                password === "" ||
                (authMode === "signup" && nicknameDraft.trim() === "")
              }
              type="submit"
            >
              {authMode === "login" ? "로그인" : "회원가입"}
            </button>
            <button
              className="authModeSwitch"
              onClick={() => {
                setAuthMode((current) => (current === "login" ? "signup" : "login"))
                setEmailDraft("")
                setPassword("")
                setNicknameDraft("")
              }}
              type="button"
            >
              {authMode === "login" ? "회원가입" : "로그인으로 돌아가기"}
            </button>
          </form>
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
    return (
      <main className="demoViewport" key="profile">
        <DemoTopBar label="MY" />
        <section className="demoScreen demoScrollableScreen">
          <div className="demoHeading">
            <h1>내 정보</h1>
          </div>
          <section className="profileCard">
            <span aria-hidden="true" className="profileAvatar">
              {nickname.trim().charAt(0) || "P"}
            </span>
            <div>
              <h2>{nickname}</h2>
              <p>{email}</p>
            </div>
            <button
              aria-label="닉네임 변경"
              className="profileEditButton buttonQuiet"
              onClick={() => {
                setNicknameDraft(nickname)
                setEditingNickname(true)
              }}
              type="button"
            >
              변경
            </button>
          </section>
          <PurchasedRewards purchasedRewardIds={purchasedRewardIds} />
          <div className="demoBottomAction">
            <button
              className="buttonFull buttonQuiet demoPrimaryButton"
              onClick={() => {
                demo.logout()
                setAuthMode("login")
                setEmailDraft("")
                setPassword("")
                resetRoutineView()
              }}
              type="button"
            >
              로그아웃
            </button>
            <button
              className="buttonFull buttonQuiet"
              onClick={() => setResetOpen(true)}
              ref={resetTriggerRef}
              type="button"
            >
              데모 초기화
            </button>
          </div>
        </section>
        <DemoBottomNav current="profile" onNavigate={navigate} />
        {editingNickname ? (
          <dialog
            aria-labelledby="nickname-sheet-title"
            className="rewardSheet profileEditSheet"
            onCancel={() => setEditingNickname(false)}
            ref={nicknameDialogRef}
          >
            <h2 id="nickname-sheet-title">닉네임 변경</h2>
            <label className="formField">
              <span className="formLabel">새 닉네임</span>
              <input
                autoFocus
                className="formInput demoGoalInput"
                maxLength={16}
                onChange={(event) => setNicknameDraft(event.target.value)}
                value={nicknameDraft}
              />
            </label>
            <div className="rewardSheetActions">
              <button
                className="buttonQuiet"
                onClick={() => setEditingNickname(false)}
                type="button"
              >
                취소
              </button>
              <button
                disabled={nicknameDraft.trim() === ""}
                onClick={() => {
                  demo.dispatch({ nickname: nicknameDraft.trim(), type: "update_profile" })
                  setEditingNickname(false)
                }}
                type="button"
              >
                저장
              </button>
            </div>
          </dialog>
        ) : null}
        {resetOpen ? (
          <dialog
            aria-labelledby="reset-demo-title"
            className="rewardSheet profileEditSheet"
            onCancel={() => {
              setResetOpen(false)
              window.requestAnimationFrame(() => resetTriggerRef.current?.focus())
            }}
            ref={resetDialogRef}
          >
            <h2 id="reset-demo-title">데모를 초기화할까요?</h2>
            <p>이 기기의 프로필, 목표, 포인트와 예측 기록만 지워져요.</p>
            <div className="rewardSheetActions">
              <button
                className="buttonQuiet"
                onClick={() => {
                  setResetOpen(false)
                  window.requestAnimationFrame(() => resetTriggerRef.current?.focus())
                }}
                type="button"
              >
                취소
              </button>
              <button
                onClick={() => {
                  demo.reset()
                  resetRoutineView()
                  setAuthMode("login")
                  setEmailDraft("")
                  setPassword("")
                  setNicknameDraft("")
                  setResetOpen(false)
                  setResetFocusPending(true)
                }}
                type="button"
              >
                초기화하기
              </button>
            </div>
          </dialog>
        ) : null}
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
