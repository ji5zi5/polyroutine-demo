import type { DemoAction, DemoState, LedgerEvent } from "./schema"
import { demoStateSchema } from "./schema"

export type DemoDependencies = Readonly<{
  createId: () => string
  now: () => Date
}>

export type DemoInvariantResult = Readonly<{
  valid: boolean
  violations: readonly string[]
}>

type DemoDomainErrorCode =
  | "coupon_not_found"
  | "duplicate_id"
  | "goal_not_found"
  | "insufficient_balance"
  | "invalid_state"
  | "round_not_open"
  | "unknown_action"

export class DemoDomainError extends Error {
  readonly code: DemoDomainErrorCode

  constructor(code: DemoDomainErrorCode) {
    super(code)
    this.code = code
    this.name = "DemoDomainError"
  }
}

export function selectBalance(state: DemoState): number {
  return state.balance
}

export function selectCoupons(state: DemoState): DemoState["coupons"] {
  return state.coupons
}

export function selectLedger(state: DemoState): DemoState["ledger"] {
  return state.ledger
}

export function selectPositions(state: DemoState): DemoState["positions"] {
  return state.positions
}

function ledgerBalance(state: DemoState): number {
  return state.ledger.reduce((balance, event) => {
    return event.direction === "credit" ? balance + event.amount : balance - event.amount
  }, state.initialBalance)
}

function duplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length
}

export function validateDemoInvariants(state: DemoState): DemoInvariantResult {
  const violations: string[] = []
  if (ledgerBalance(state) !== state.balance) violations.push("balance_mismatch")
  if (state.balance < 0) violations.push("negative_balance")
  if (duplicates(state.ledger.map((event) => event.id))) violations.push("duplicate_event_id")
  if (duplicates(state.settledRoundIds)) violations.push("duplicate_round_settlement")
  if (duplicates(state.attendance.map((claim) => claim.localDate))) {
    violations.push("duplicate_attendance_date")
  }
  if (duplicates(state.coupons.map((coupon) => coupon.id))) violations.push("duplicate_coupon_id")
  if (
    duplicates(state.coupons.flatMap((coupon) => (coupon.status === "used" ? [coupon.useId] : [])))
  ) {
    violations.push("duplicate_coupon_use")
  }
  return { valid: violations.length === 0, violations }
}

export function parseDemoState(input: unknown): DemoState {
  const state = demoStateSchema.parse(input)
  if (!validateDemoInvariants(state).valid) throw new DemoDomainError("invalid_state")
  return state
}

export function createInitialDemoState(dependencies: DemoDependencies): DemoState {
  return parseDemoState({
    attendance: [],
    balance: 51_200,
    coupons: [],
    createdAt: dependencies.now().toISOString(),
    goals: [
      { id: "goal-morning-walk", scope: "device-local", title: "Morning walk" },
      { id: "goal-reading", scope: "device-local", title: "Read 20 minutes" },
    ],
    initialBalance: 51_200,
    ledger: [],
    positions: [],
    profile: { id: "local-profile", nickname: "Poly User", scope: "device-local" },
    round: { id: "round-1", status: "open" },
    settledRoundIds: [],
    version: 1,
  })
}

function allocatedIds(state: DemoState): readonly string[] {
  return [
    state.profile.id,
    state.round.id,
    ...state.goals.map((goal) => goal.id),
    ...state.positions.map((position) => position.id),
    ...state.ledger.map((event) => event.id),
    ...state.coupons.flatMap((coupon) =>
      coupon.status === "used" ? [coupon.id, coupon.useId] : [coupon.id],
    ),
  ]
}

export function allocateId(state: DemoState, dependencies: DemoDependencies): string {
  const id = dependencies.createId()
  if (id.length === 0 || allocatedIds(state).includes(id)) {
    throw new DemoDomainError("duplicate_id")
  }
  return id
}

export function createLedgerEvent(
  state: DemoState,
  input: Omit<LedgerEvent, "id" | "occurredAt">,
  dependencies: DemoDependencies,
): LedgerEvent {
  return {
    ...input,
    id: allocateId(state, dependencies),
    occurredAt: dependencies.now().toISOString(),
  }
}

export function appendLedgerEvent(state: DemoState, ledgerEvent: LedgerEvent): DemoState {
  const balance =
    ledgerEvent.direction === "credit"
      ? state.balance + ledgerEvent.amount
      : state.balance - ledgerEvent.amount
  if (balance < 0) throw new DemoDomainError("insufficient_balance")
  return { ...state, balance, ledger: [...state.ledger, ledgerEvent] }
}

function claimAttendance(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "claim_attendance" }>,
  dependencies: DemoDependencies,
): DemoState {
  if (state.attendance.some((claim) => claim.localDate === action.localDate)) {
    return state
  }
  const credit = createLedgerEvent(
    state,
    {
      amount: action.amount,
      direction: "credit",
      sourceId: action.localDate,
      sourceType: "attendance",
    },
    dependencies,
  )
  const credited = appendLedgerEvent(state, credit)
  return {
    ...credited,
    attendance: [...credited.attendance, { eventId: credit.id, localDate: action.localDate }],
  }
}

export function placePosition(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "place_position" }>,
  dependencies: DemoDependencies,
): DemoState {
  if (state.round.id !== action.roundId || state.round.status !== "open") {
    throw new DemoDomainError("round_not_open")
  }
  if (!state.goals.some((goal) => goal.id === action.goalId)) {
    throw new DemoDomainError("goal_not_found")
  }
  if (state.balance < action.stake) throw new DemoDomainError("insufficient_balance")
  const positionId = allocateId(state, dependencies)
  const positioned: DemoState = {
    ...state,
    positions: [...state.positions, { ...action, id: positionId }],
  }
  const debit = createLedgerEvent(
    positioned,
    {
      amount: action.stake,
      direction: "debit",
      sourceId: positionId,
      sourceType: "prediction_stake",
    },
    dependencies,
  )
  return appendLedgerEvent(positioned, debit)
}

export function applyClaimAttendance(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "claim_attendance" }>,
  dependencies: DemoDependencies,
): DemoState {
  return claimAttendance(state, action, dependencies)
}
