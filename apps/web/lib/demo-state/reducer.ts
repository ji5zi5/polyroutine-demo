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
import type { DemoAction, DemoState } from "./schema"
import { demoActionSchema } from "./schema"

function settleRound(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "settle_round" }>,
  dependencies: DemoDependencies,
): DemoState {
  if (state.round.id !== action.roundId) throw new DemoDomainError("round_not_open")
  if (state.settledRoundIds.includes(action.roundId)) return state
  let settled: DemoState = state
  for (const position of state.positions) {
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
  return {
    ...settled,
    round: { ...settled.round, status: "settled" },
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
  )
  const debited = appendLedgerEvent(state, debit)
  return {
    ...debited,
    coupons: [
      ...debited.coupons,
      {
        catalogId: action.catalogId,
        cost: action.cost,
        id: couponId,
        label: action.label,
        purchaseEventId: debit.id,
        status: "available",
      },
    ],
  }
}

function redeemCoupon(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "use_coupon" }>,
  dependencies: DemoDependencies,
): DemoState {
  const coupon = state.coupons.find((candidate) => candidate.id === action.couponId)
  if (coupon === undefined) throw new DemoDomainError("coupon_not_found")
  if (coupon.status === "used") return state
  const useId = allocateId(state, dependencies)
  return {
    ...state,
    coupons: state.coupons.map((candidate) =>
      candidate.id === coupon.id
        ? {
            ...coupon,
            status: "used",
            useId,
            usedAt: dependencies.now().toISOString(),
          }
        : candidate,
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
    case "claim_attendance":
      next = applyClaimAttendance(state, action, dependencies)
      break
    case "place_position":
      next = placePosition(state, action, dependencies)
      break
    case "purchase_coupon":
      next = purchaseCoupon(state, action, dependencies)
      break
    case "settle_round":
      next = settleRound(state, action, dependencies)
      break
    case "use_coupon":
      next = redeemCoupon(state, action, dependencies)
      break
    default:
      return assertNever(action)
  }
  if (next === state) return inputState
  return parseDemoState(next)
}
