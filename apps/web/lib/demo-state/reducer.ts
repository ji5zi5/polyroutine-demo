import { couponInstanceSchema, couponUseIdSchema } from "../demo-coupons/coupon-types"
import type { DemoDependencies } from "./domain"
import {
  allocateId,
  appendLedgerEvent,
  applyClaimAttendance,
  createLedgerEvent,
  DemoDomainError,
  parseDemoState,
  placePosition,
} from "./domain"
import { placeMarketPosition, settleMarketRound } from "./market"
import type { DemoAction, DemoState } from "./schema"
import { demoActionSchema } from "./schema"

function settleRound(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "settle_round" }>,
  dependencies: DemoDependencies,
): DemoState {
  if (state.settledRoundIds.includes(action.roundId)) return state
  if (state.round.id !== action.roundId) throw new DemoDomainError("round_not_open")
  let settled: DemoState = state
  for (const position of state.positions) {
    if ("kind" in position) continue
    if (
      position.roundId !== action.roundId ||
      action.outcomes[position.goalId] !== position.choice
    ) {
      continue
    }
    const credit = createLedgerEvent(
      settled,
      {
        amount: position.grossPayout,
        direction: "credit",
        sourceId: position.id,
        sourceType: "prediction_payout",
      },
      dependencies,
    )
    settled = appendLedgerEvent(settled, credit)
  }
  const nextRoundId = `${action.roundId}-next-${state.settledRoundIds.length + 1}`
  return {
    ...settled,
    positions: settled.positions.filter((position) => position.roundId !== action.roundId),
    round: {
      id: nextRoundId,
      openedAt: dependencies.now().toISOString(),
      status: "open",
    },
    settledRoundIds: [...settled.settledRoundIds, action.roundId],
  }
}

function purchaseCoupon(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "purchase_coupon" }>,
  dependencies: DemoDependencies,
): DemoState {
  if (state.balance < action.cost) throw new DemoDomainError("insufficient_balance")
  const couponId = allocateId(state, dependencies)
  const debit = createLedgerEvent(
    state,
    {
      amount: action.cost,
      direction: "debit",
      sourceId: couponId,
      sourceType: "coupon_purchase",
    },
    dependencies,
    [couponId],
  )
  const debited = appendLedgerEvent(state, debit)
  const coupon = couponInstanceSchema.parse({
    catalogId: action.catalogId,
    cost: action.cost,
    id: couponId,
    label: action.label,
    purchaseEventId: debit.id,
    purchasedAt: debit.occurredAt,
    useId: null,
    usedAt: null,
  })
  return {
    ...debited,
    coupons: [...debited.coupons, coupon],
  }
}

function redeemCoupon(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "use_coupon" }>,
  dependencies: DemoDependencies,
): DemoState {
  const coupon = state.coupons.find((candidate) => candidate.id === action.couponId)
  if (coupon === undefined) throw new DemoDomainError("coupon_not_found")
  if (coupon.usedAt !== null) return state
  const useId = couponUseIdSchema.parse(allocateId(state, dependencies))
  return {
    ...state,
    coupons: state.coupons.map((candidate) =>
      candidate.id === coupon.id
        ? {
            ...coupon,
            useId,
            usedAt: dependencies.now().toISOString(),
          }
        : candidate,
    ),
  }
}

function creditGoalCompletion(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "credit_goal_completion" }>,
  dependencies: DemoDependencies,
): DemoState {
  if (!state.goals.some((goal) => goal.id === action.goalId)) {
    throw new DemoDomainError("goal_not_found")
  }
  if (
    state.ledger.some(
      (event) => event.sourceType === "goal_completion" && event.sourceId === action.goalId,
    )
  ) {
    return state
  }
  const credit = createLedgerEvent(
    state,
    {
      amount: action.amount,
      direction: "credit",
      sourceId: action.goalId,
      sourceType: "goal_completion",
    },
    dependencies,
  )
  return appendLedgerEvent(state, credit)
}

function replaceGoals(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "replace_goals" }>,
  dependencies: DemoDependencies,
): DemoState {
  if (
    state.goals.length === action.titles.length &&
    state.goals.every((goal, index) => goal.title === action.titles[index])
  ) {
    return state
  }
  let allocationState = state
  const goals = action.titles.map((title) => {
    const existing = state.goals.find((goal) => goal.title === title)
    if (existing !== undefined) return existing
    const goal = {
      id: allocateId(allocationState, dependencies),
      scope: "device-local" as const,
      title,
    }
    allocationState = { ...allocationState, goals: [...allocationState.goals, goal] }
    return goal
  })
  return { ...state, goals }
}

function listGoals(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "list_goals" }>,
  dependencies: DemoDependencies,
): DemoState {
  return {
    ...state,
    listedGoals: [
      ...state.listedGoals,
      {
        deadline: action.deadline,
        id: allocateId(state, dependencies),
        probability: action.probability,
        titles: action.titles,
      },
    ],
  }
}

function updateListedGoalDeadline(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "update_listed_goal_deadline" }>,
): DemoState {
  if (!state.listedGoals.some((listing) => listing.id === action.listingId)) {
    throw new DemoDomainError("listing_not_found")
  }
  return {
    ...state,
    listedGoals: state.listedGoals.map((listing) =>
      listing.id === action.listingId ? { ...listing, deadline: action.deadline } : listing,
    ),
  }
}

function assertNever(_action: never): never {
  throw new DemoDomainError("unknown_action")
}

export function reduceDemoState(
  inputState: DemoState,
  inputAction: unknown,
  dependencies: DemoDependencies,
): DemoState {
  const state = parseDemoState(inputState)
  const action = demoActionSchema.parse(inputAction)
  let next: DemoState
  switch (action.type) {
    case "credit_goal_completion":
      next = creditGoalCompletion(state, action, dependencies)
      break
    case "claim_attendance":
      next = applyClaimAttendance(state, action, dependencies)
      break
    case "place_position":
      next = placePosition(state, action, dependencies)
      break
    case "place_market_position":
      next = placeMarketPosition(state, action, dependencies).state
      break
    case "list_goals":
      next = listGoals(state, action, dependencies)
      break
    case "purchase_coupon":
      next = purchaseCoupon(state, action, dependencies)
      break
    case "replace_goals":
      next = replaceGoals(state, action, dependencies)
      break
    case "settle_round":
      next = settleRound(state, action, dependencies)
      break
    case "settle_market_round":
      next = settleMarketRound(state, action, dependencies)
      break
    case "skip_market_card":
      next = state
      break
    case "use_coupon":
      next = redeemCoupon(state, action, dependencies)
      break
    case "update_profile":
      next = { ...state, profile: { ...state.profile, nickname: action.nickname } }
      break
    case "update_listed_goal_deadline":
      next = updateListedGoalDeadline(state, action)
      break
    default:
      return assertNever(action)
  }
  if (next === state) return inputState
  return parseDemoState(next)
}
