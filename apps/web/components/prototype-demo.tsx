"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import {
  type MarketPosition,
  type MarketRoundHistory,
  selectMarketRoundHistory,
  selectPendingMarketPositions,
} from "../lib/demo-state"
import { PortfolioHistory } from "./demo-market/portfolio-history"
import { demoPredictionOutcomes, predictionCards } from "./demo-prediction-cards"
import { usePersistentDemoState } from "./demo-state/use-persistent-demo-state"
import { PredictionCard } from "./prediction-card"

const rewardCatalog = [
  {
    cost: 50_000,
    id: "convenience",
    imageSrc: "/rewards/gs25-1000.jpg",
    name: "GS25 모바일 상품권 1천원권",
  },
  {
    cost: 200_000,
    id: "americano",
    imageSrc: "/rewards/americano-coupon.png",
    name: "아이스 아메리카노",
  },
  {
    cost: 260_000,
    id: "starbucks-latte",
    imageSrc: "/rewards/starbucks-latte.jpg",
    name: "스타벅스 아이스 카페 라떼T",
  },
  {
    cost: 120_000,
    id: "mcdonald-sundae",
    imageSrc: "/rewards/mcdonald-sundae.jpg",
    name: "맥도날드 초코 선데이",
  },
  {
    cost: 500_000,
    id: "naverpay-10000",
    imageSrc: "/rewards/naverpay-10000.jpg",
    name: "네이버페이 포인트 10,000원",
  },
  {
    cost: 50_000,
    id: "oliveyoung-1000",
    imageSrc: "/rewards/oliveyoung-1000.png",
    name: "올리브영 모바일 상품권 1,000원",
  },
  {
    cost: 250_000,
    id: "shinsegae-5000",
    imageSrc: "/rewards/shinsegae-5000.jpg",
    name: "신세계상품권 5천원권",
  },
  {
    cost: 1_500_000,
    id: "baskin-30000",
    imageSrc: "/rewards/baskin-30000.jpg",
    name: "배스킨라빈스 교환권 30,000원",
  },
] as const

type RewardItem = (typeof rewardCatalog)[number]
type RewardId = RewardItem["id"]

function isRewardId(value: string): value is RewardId {
  return rewardCatalog.some((reward) => reward.id === value)
}

function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function calculateSuccessProbability(goal: string): number {
  const normalized = goal.trim()
  if (normalized === "") return 0

  const taskCount = normalized.split(/\r?\n/).filter((task) => task.trim() !== "").length

  let textVariation = 0
  for (const character of normalized) {
    textVariation = (textVariation * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  }

  let score = 34 + Math.min(12, Math.floor(normalized.length * 0.8))
  if (/\d/.test(normalized)) score += 10
  if (/(분|시간|쪽|장|개|줄|회)/.test(normalized)) score += 8
  if (/(요약|기록|복습|완료|풀기|읽기|운동)/.test(normalized)) score += 7
  if (normalized.length >= 10 && normalized.length <= 30) score += 5
  score -= Math.max(0, taskCount - 1) * 4
  score += (textVariation % 9) - 4
  return Math.max(32, Math.min(89, score))
}

type DemoStep =
  | "goal"
  | "listed"
  | "points"
  | "predict"
  | "profile"
  | "settle"
  | "verified"
  | "verify"
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

function CheckIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="3" />
      <path
        d="m15 24 6 6 12-13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />
    </svg>
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

type PointsScreenProps = {
  readonly attendanceClaimed: boolean
  readonly onClaimAttendance: () => void
  readonly onNavigate: (tab: DemoTab) => void
  readonly onPurchase: (reward: RewardItem) => void
  readonly onSettlePredictions: () => void
  readonly pendingPositions: readonly MarketPosition[]
  readonly points: number
  readonly rounds: readonly MarketRoundHistory[]
}

function PointsScreen({
  attendanceClaimed,
  onClaimAttendance,
  onNavigate,
  onPurchase,
  onSettlePredictions,
  pendingPositions,
  points,
  rounds,
}: PointsScreenProps) {
  const attendanceDialogRef = useRef<HTMLDialogElement>(null)
  const rewardDialogRef = useRef<HTMLDialogElement>(null)
  const [attendanceOpen, setAttendanceOpen] = useState(false)
  const [selectedReward, setSelectedReward] = useState<RewardItem | null>(null)
  const [settlementFeedback, setSettlementFeedback] = useState<number | null>(null)

  useEffect(() => {
    const dialog = attendanceDialogRef.current
    if (attendanceOpen && dialog !== null && !dialog.open) dialog.showModal()
  }, [attendanceOpen])

  useEffect(() => {
    const dialog = rewardDialogRef.current
    if (selectedReward !== null && dialog !== null && !dialog.open) dialog.showModal()
  }, [selectedReward])

  useEffect(() => {
    if (settlementFeedback === null) return
    const timer = window.setTimeout(() => setSettlementFeedback(null), 800)
    return () => window.clearTimeout(timer)
  }, [settlementFeedback])

  return (
    <main className="demoViewport" key="points">
      <DemoTopBar label="포인트" />
      <section className="demoScreen demoScrollableScreen">
        <div className="demoHeading">
          <h1>내 포인트</h1>
        </div>
        <section className="pointsCard" data-settled={settlementFeedback !== null}>
          <span>보유 포인트</span>
          <strong>{points.toLocaleString("ko-KR")}점</strong>
          <button
            className="attendanceButton buttonQuiet"
            onClick={() => setAttendanceOpen(true)}
            type="button"
          >
            {attendanceClaimed ? "오늘 출석 완료" : "출석체크"}
          </button>
        </section>
        {pendingPositions.length === 0 && settlementFeedback === null ? null : (
          <section className="marketPortfolio">
            <div>
              <span>예측 포지션</span>
              <strong>
                {settlementFeedback === null
                  ? `투자 ${(pendingPositions.length * 100).toLocaleString("ko-KR")}P · ${pendingPositions.length}건 대기`
                  : `적중 정산 +${settlementFeedback}P`}
              </strong>
            </div>
            <button
              aria-live="polite"
              className={
                settlementFeedback !== null ? "buttonQuiet settlementFeedbackButton" : "buttonQuiet"
              }
              disabled={settlementFeedback !== null}
              onClick={() => {
                if (settlementFeedback !== null) return
                setSettlementFeedback(
                  pendingPositions.reduce(
                    (total, position) =>
                      position.choice === position.fixtureOutcome
                        ? total + position.grossPayout
                        : total,
                    0,
                  ),
                )
                onSettlePredictions()
              }}
              type="button"
            >
              {settlementFeedback === null ? "예측 결과 정산하기" : `+${settlementFeedback}P 적중`}
            </button>
          </section>
        )}
        {pendingPositions.length === 0 && rounds.length === 0 ? null : (
          <PortfolioHistory pendingPositions={pendingPositions} rounds={rounds} />
        )}
        <section className="rewardShop">
          <h2>포인트 상점</h2>
          <div className="rewardGrid">
            {rewardCatalog.map((reward) => {
              return (
                <article className="rewardProduct" key={reward.id}>
                  <RewardImage reward={reward} />
                  <h3>{reward.name}</h3>
                  <button
                    aria-label={`${reward.name} ${reward.cost.toLocaleString("ko-KR")}P로 구매`}
                    className="rewardBuyButton"
                    disabled={points < reward.cost}
                    onClick={() => setSelectedReward(reward)}
                    type="button"
                  >
                    {reward.cost.toLocaleString("ko-KR")}P
                  </button>
                </article>
              )
            })}
          </div>
        </section>
      </section>
      <DemoBottomNav current="points" onNavigate={onNavigate} />
      {attendanceOpen ? (
        <dialog
          aria-labelledby="attendance-sheet-title"
          className="attendanceSheet"
          onCancel={() => setAttendanceOpen(false)}
          ref={attendanceDialogRef}
        >
          <div className="attendanceSheetHeading">
            <span>연속 4일째</span>
            <h2 id="attendance-sheet-title">8월 출석체크</h2>
          </div>
          <figure aria-label="2026년 8월 출석 달력" className="attendanceCalendar">
            {["일", "월", "화", "수", "목", "금", "토"].map((weekday) => (
              <span className="attendanceWeekday" key={weekday}>
                {weekday}
              </span>
            ))}
            {["sun", "mon", "tue", "wed", "thu", "fri"].map((weekday) => (
              <span aria-hidden="true" key={`blank-${weekday}`} />
            ))}
            {Array.from({ length: 31 }, (_, index) => {
              const day = index + 1
              const attended = day >= 17 && day <= 19
              const today = day === 20
              return (
                <span
                  aria-current={today ? "date" : undefined}
                  className={attended || (today && attendanceClaimed) ? "isAttended" : undefined}
                  key={day}
                >
                  {attended || (today && attendanceClaimed) ? "✓" : day}
                </span>
              )
            })}
          </figure>
          <button
            className="buttonFull"
            disabled={attendanceClaimed}
            onClick={() => {
              onClaimAttendance()
              setAttendanceOpen(false)
            }}
            type="button"
          >
            {attendanceClaimed ? "오늘 출석 완료 · +200P" : "오늘 출석하기 · +200P"}
          </button>
          <button
            className="attendanceClose"
            onClick={() => setAttendanceOpen(false)}
            type="button"
          >
            닫기
          </button>
        </dialog>
      ) : null}
      {selectedReward === null ? null : (
        <dialog
          aria-labelledby="reward-sheet-title"
          className="rewardSheet"
          onCancel={() => setSelectedReward(null)}
          ref={rewardDialogRef}
        >
          <RewardImage reward={selectedReward} />
          <h2 id="reward-sheet-title">{selectedReward.name}</h2>
          <p>{selectedReward.cost.toLocaleString("ko-KR")}점을 사용할게요.</p>
          <div className="rewardSheetActions">
            <button className="buttonQuiet" onClick={() => setSelectedReward(null)} type="button">
              취소
            </button>
            <button
              onClick={() => {
                onPurchase(selectedReward)
                setSelectedReward(null)
              }}
              type="button"
            >
              구매하기
            </button>
          </div>
        </dialog>
      )}
    </main>
  )
}

function PurchasedRewards({
  purchasedRewardIds,
}: {
  readonly purchasedRewardIds: readonly RewardId[]
}) {
  const purchasedRewards = rewardCatalog
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
  const analysisTimer = useRef<number | null>(null)
  const loginEmailRef = useRef<HTMLInputElement>(null)
  const nicknameDialogRef = useRef<HTMLDialogElement>(null)
  const resetDialogRef = useRef<HTMLDialogElement>(null)
  const resetTriggerRef = useRef<HTMLButtonElement>(null)
  const verificationTimer = useRef<number | null>(null)
  const [step, setStep] = useState<DemoStep>("predict")
  const [authMode, setAuthMode] = useState<AuthMode>("login")
  const [cardIndex, setCardIndex] = useState(0)
  const [emailDraft, setEmailDraft] = useState("")
  const [evidencePreviewUrl, setEvidencePreviewUrl] = useState("")
  const [goalText, setGoalText] = useState("")
  const [nicknameDraft, setNicknameDraft] = useState("")
  const [password, setPassword] = useState("")
  const [probability, setProbability] = useState<number | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [editingNickname, setEditingNickname] = useState(false)
  const [marketMessage, setMarketMessage] = useState("")
  const [resetOpen, setResetOpen] = useState(false)
  const [resetFocusPending, setResetFocusPending] = useState(false)
  const [verifying, setVerifying] = useState(false)

  const snapshot = demo.snapshot
  const demoState = demo.state
  const authenticated = snapshot?.authenticated ?? false
  const email = snapshot?.email ?? ""
  const goalItems = demoState?.goals.map((goal) => goal.title) ?? []
  const nickname = demoState?.profile.nickname ?? "폴리 유저"
  const points = demoState?.balance ?? 0
  const pendingPositions = demoState === null ? [] : selectPendingMarketPositions(demoState)
  const marketRounds = demoState === null ? [] : selectMarketRoundHistory(demoState)
  const attendanceClaimed =
    demoState?.attendance.some((claim) => claim.localDate === localDate(new Date())) ?? false
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

  useEffect(() => {
    return () => {
      if (analysisTimer.current !== null) window.clearTimeout(analysisTimer.current)
      if (verificationTimer.current !== null) window.clearTimeout(verificationTimer.current)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (evidencePreviewUrl !== "") URL.revokeObjectURL(evidencePreviewUrl)
    }
  }, [evidencePreviewUrl])

  const addGoalItem = (): void => {
    const nextGoal = goalText.trim()
    if (nextGoal === "" || (!goalItems.includes(nextGoal) && goalItems.length >= 5)) return

    const nextGoals = goalItems.includes(nextGoal) ? goalItems : [...goalItems, nextGoal]
    demo.dispatch({ titles: nextGoals, type: "replace_goals" })
    setGoalText("")
    setProbability(null)
  }

  const beginGoalAnalysis = (): void => {
    const pendingGoal = goalText.trim()
    const goalsToAnalyze =
      pendingGoal !== "" && !goalItems.includes(pendingGoal)
        ? [...goalItems, pendingGoal]
        : goalItems
    if (goalsToAnalyze.length === 0) return

    demo.dispatch({ titles: goalsToAnalyze, type: "replace_goals" })
    setGoalText("")
    setAnalyzing(true)
    analysisTimer.current = window.setTimeout(() => {
      setProbability(calculateSuccessProbability(goalsToAnalyze.join("\n")))
      setAnalyzing(false)
      analysisTimer.current = null
    }, 1_000)
  }

  const resetRoutineView = (): void => {
    setCardIndex(0)
    setGoalText("")
    setEvidencePreviewUrl("")
    setProbability(null)
    setAnalyzing(false)
    setMarketMessage("")
    setVerifying(false)
    setStep("predict")
  }

  const navigate = (tab: DemoTab): void => {
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
        <section className="demoScreen">
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
                  setProbability(null)
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
                      setProbability(null)
                    }}
                    type="button"
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {analyzing ? (
            <section aria-live="polite" className="analysisCard">
              <span className="analysisSpinner" role="status">
                <i />
                <i />
                <i />
              </span>
              <strong>AI가 목표를 분석하고 있어요</strong>
              <span>구체성 · 분량 · 실행 시간을 확인해요</span>
            </section>
          ) : null}
          {probability !== null ? (
            <section aria-label="AI 예상 성공 확률" className="probabilityCard">
              <span>AI 예상 성공 확률</span>
              <strong>{probability}%</strong>
            </section>
          ) : null}
          <div className="demoBottomAction">
            {probability !== null ? (
              <button
                className="buttonFull demoPrimaryButton"
                onClick={() => {
                  setStep("listed")
                }}
                type="button"
              >
                이 목표 상장하기
              </button>
            ) : (
              <button
                className="buttonFull demoPrimaryButton"
                disabled={(goalItems.length === 0 && goalText.trim() === "") || analyzing}
                onClick={beginGoalAnalysis}
                type="button"
              >
                {analyzing ? "목표 분석 중" : "성공 확률 분석하기"}
              </button>
            )}
          </div>
        </section>
        <DemoBottomNav current="goal" onNavigate={navigate} />
      </main>
    )
  }

  if (step === "listed") {
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
                <dd>{probability ?? calculateSuccessProbability(goalItems.join("\n"))}%</dd>
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

  if (step === "verify" || step === "verified") {
    const verified = step === "verified"
    return (
      <main className="demoViewport" key={step}>
        <DemoTopBar label="인증" />
        <section className="demoScreen">
          <div className="demoHeading">
            <h1>{verified ? "인증이 끝났어요" : "사진 인증"}</h1>
            {!verified ? <p>오늘 목표가 보이도록 찍어주세요.</p> : null}
          </div>
          {verified ? (
            <div className="verificationVisual isComplete">
              <CheckIcon />
              <strong>목표와 일치해요</strong>
            </div>
          ) : (
            <label className="verificationVisual evidenceSurface">
              <input
                accept="image/*"
                capture="environment"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file === undefined) return
                  if (evidencePreviewUrl !== "") URL.revokeObjectURL(evidencePreviewUrl)
                  setEvidencePreviewUrl(URL.createObjectURL(file))
                }}
                type="file"
              />
              {evidencePreviewUrl !== "" ? (
                <>
                  <Image
                    alt="선택한 인증 사진"
                    fill
                    sizes="(max-width: 390px) 100vw, 390px"
                    src={evidencePreviewUrl}
                    unoptimized
                  />
                  <span className="replacePhotoLabel">다른 사진 선택</span>
                </>
              ) : (
                <span className="cameraPrompt">
                  <svg aria-hidden="true" fill="none" viewBox="0 0 48 48">
                    <rect
                      height="30"
                      rx="6"
                      stroke="currentColor"
                      strokeWidth="3"
                      width="38"
                      x="5"
                      y="11"
                    />
                    <circle cx="24" cy="26" r="7" stroke="currentColor" strokeWidth="3" />
                    <path
                      d="M17 11 20 7h8l3 4"
                      stroke="currentColor"
                      strokeLinejoin="round"
                      strokeWidth="3"
                    />
                  </svg>
                  <strong>사진 촬영 또는 선택</strong>
                </span>
              )}
            </label>
          )}
          <div className="demoBottomAction">
            {verified ? (
              <button
                className="buttonFull demoPrimaryButton"
                onClick={() => {
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
                type="button"
              >
                정산 결과 보기
              </button>
            ) : (
              <button
                className="buttonFull demoPrimaryButton"
                disabled={evidencePreviewUrl === "" || verifying}
                onClick={() => {
                  setVerifying(true)
                  verificationTimer.current = window.setTimeout(() => {
                    setVerifying(false)
                    setStep("verified")
                  }, 1_000)
                }}
                type="button"
              >
                {verifying ? "사진 확인 중…" : "사진 인증하기"}
              </button>
            )}
          </div>
        </section>
        <DemoBottomNav current="goal" onNavigate={navigate} />
      </main>
    )
  }

  if (step === "points") {
    return (
      <PointsScreen
        attendanceClaimed={attendanceClaimed}
        key="points"
        onClaimAttendance={() => {
          demo.dispatch({ amount: 200, localDate: localDate(new Date()), type: "claim_attendance" })
        }}
        onNavigate={navigate}
        onPurchase={(reward) => {
          demo.dispatch({
            catalogId: reward.id,
            cost: reward.cost,
            label: reward.name,
            type: "purchase_coupon",
          })
        }}
        onSettlePredictions={() => {
          demo.dispatch({ roundId: demoState.round.id, type: "settle_market_round" })
        }}
        pendingPositions={pendingPositions}
        points={points}
        rounds={marketRounds}
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
