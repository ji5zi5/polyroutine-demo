import {
  ATTENDANCE_CREDIT_POINTS,
  type DemoAction,
  type DemoState,
  type LedgerEvent,
} from "../demo-state/index"

export type AttendanceEligibility =
  | Readonly<{
      action: Extract<DemoAction, { readonly type: "claim_attendance" }>
      kind: "eligible"
      localDate: string
    }>
  | Readonly<{
      eventId: string
      kind: "claimed"
      localDate: string
    }>

export type PointTransaction = Readonly<{
  amount: number
  direction: LedgerEvent["direction"]
  eventId: string
  label: string
  occurredAt: string
  resultingBalance: number
  signedAmount: number
  sourceType: LedgerEvent["sourceType"]
}>

export type PointReconciliation = Readonly<{
  calculatedBalance: number
  displayedBalance: number
  initialBalance: number
  isBalanced: boolean
  transactionCount: number
}>

export type PointAvailability =
  | Readonly<{
      held: number
      kind: "sufficient"
      remaining: number
      required: number
    }>
  | Readonly<{
      held: number
      kind: "insufficient"
      required: number
      shortfall: number
    }>

function assertNever(value: never): never {
  throw new TypeError(`Unexpected ledger source type: ${JSON.stringify(value)}`)
}

function transactionLabel(sourceType: LedgerEvent["sourceType"]): string {
  switch (sourceType) {
    case "attendance":
      return "출석 적립"
    case "coupon_purchase":
      return "상품 구매"
    case "goal_completion":
      return "사진 인증 보상"
    case "prediction_payout":
      return "예측 정산"
    case "prediction_stake":
      return "예측 참여"
    default:
      return assertNever(sourceType)
  }
}

function signedAmount(event: LedgerEvent): number {
  return event.direction === "credit" ? event.amount : -event.amount
}

function twoDigits(value: number): string {
  return value.toString().padStart(2, "0")
}

export function toBrowserLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
}

export function selectAttendanceEligibility(state: DemoState, now: Date): AttendanceEligibility {
  const localDate = toBrowserLocalDateKey(now)
  const claim = state.attendance.find((candidate) => candidate.localDate === localDate)
  if (claim !== undefined) {
    return { eventId: claim.eventId, kind: "claimed", localDate }
  }
  return {
    action: { amount: ATTENDANCE_CREDIT_POINTS, localDate, type: "claim_attendance" },
    kind: "eligible",
    localDate,
  }
}

export function selectPointTransactions(state: DemoState): readonly PointTransaction[] {
  let balance = state.initialBalance
  const chronological = state.ledger.map((event, index) => {
    const amount = signedAmount(event)
    balance += amount
    return {
      index,
      transaction: {
        amount: event.amount,
        direction: event.direction,
        eventId: event.id,
        label: transactionLabel(event.sourceType),
        occurredAt: event.occurredAt,
        resultingBalance: balance,
        signedAmount: amount,
        sourceType: event.sourceType,
      } satisfies PointTransaction,
    }
  })
  return chronological
    .toSorted((left, right) => {
      const timestampOrder =
        Date.parse(right.transaction.occurredAt) - Date.parse(left.transaction.occurredAt)
      return timestampOrder === 0 ? right.index - left.index : timestampOrder
    })
    .map(({ transaction }) => transaction)
}

export function reconcilePoints(state: DemoState): PointReconciliation {
  const calculatedBalance = state.ledger.reduce(
    (balance, event) => balance + signedAmount(event),
    state.initialBalance,
  )
  return {
    calculatedBalance,
    displayedBalance: state.balance,
    initialBalance: state.initialBalance,
    isBalanced: calculatedBalance === state.balance,
    transactionCount: state.ledger.length,
  }
}

export function selectPointAvailability(held: number, required: number): PointAvailability {
  if (held < required) {
    return { held, kind: "insufficient", required, shortfall: required - held }
  }
  return { held, kind: "sufficient", remaining: held - required, required }
}

export function pointShortageMessage(availability: PointAvailability): string | null {
  switch (availability.kind) {
    case "insufficient": {
      const points = new Intl.NumberFormat("ko-KR")
      return `${points.format(availability.required)}P 필요 · 보유 ${points.format(availability.held)}P · ${points.format(availability.shortfall)}P 부족`
    }
    case "sufficient":
      return null
    default:
      return assertNever(availability)
  }
}
