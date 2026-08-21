import type { DemoDependencies } from "./domain"
import { allocateId, appendLedgerEvent, createLedgerEvent, DemoDomainError } from "./domain"
import type { ArchivedMarketPosition, DemoAction, DemoState, MarketPosition } from "./schema"

export type InsufficientFunds = Readonly<{
  held: number
  kind: "insufficient_funds"
  required: number
  shortfall: number
  state: DemoState
}>

export type PositionPlaced = Readonly<{
  kind: "placed"
  position: MarketPosition
  state: DemoState
}>

export type PlaceMarketPositionOutcome = InsufficientFunds | PositionPlaced

export type MarketRoundHistory = Readonly<{
  positions: readonly ArchivedMarketPosition[]
  roundId: string
  totalPayout: number
  totalStake: number
}>

export function calculateGrossPayout(stake: 100, selectedPercent: number): number {
  return Math.ceil((stake * 100) / selectedPercent)
}

export function placeMarketPosition(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "place_market_position" }>,
  dependencies: DemoDependencies,
): PlaceMarketPositionOutcome {
  if (state.round.id !== action.roundId || state.round.status !== "open") {
    throw new DemoDomainError("round_not_open")
  }
  if (state.balance < action.stake) {
    return {
      held: state.balance,
      kind: "insufficient_funds",
      required: action.stake,
      shortfall: action.stake - state.balance,
      state,
    }
  }
  const position: MarketPosition = {
    cardId: action.cardId,
    cardLabel: action.cardLabel,
    choice: action.choice,
    crowdPercentage: action.crowdPercentage,
    fixtureOutcome: action.fixtureOutcome,
    grossPayout: calculateGrossPayout(action.stake, action.crowdPercentage),
    id: allocateId(state, dependencies),
    kind: "market",
    placedAt: dependencies.now().toISOString(),
    roundId: action.roundId,
    stake: action.stake,
  }
  const positioned: DemoState = { ...state, positions: [...state.positions, position] }
  const debit = createLedgerEvent(
    positioned,
    {
      amount: action.stake,
      direction: "debit",
      sourceId: position.id,
      sourceType: "prediction_stake",
    },
    dependencies,
  )
  return { kind: "placed", position, state: appendLedgerEvent(positioned, debit) }
}

export function settleMarketRound(
  state: DemoState,
  action: Extract<DemoAction, { readonly type: "settle_market_round" }>,
  dependencies: DemoDependencies,
): DemoState {
  if (state.settledRoundIds.includes(action.roundId)) return state
  if (state.round.id !== action.roundId || state.round.status !== "open") {
    throw new DemoDomainError("round_not_open")
  }
  let settled = state
  const settledAt = dependencies.now().toISOString()
  const pending = state.positions.filter(
    (position): position is MarketPosition =>
      "kind" in position && position.kind === "market" && position.roundId === action.roundId,
  )
  const archived: ArchivedMarketPosition[] = []
  for (const position of pending) {
    const won = position.choice === position.fixtureOutcome
    if (won) {
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
    archived.push({
      actualOutcome: position.fixtureOutcome,
      cardId: position.cardId,
      cardLabel: position.cardLabel,
      choice: position.choice,
      crowdPercentage: position.crowdPercentage,
      fixtureOutcome: position.fixtureOutcome,
      grossPayout: position.grossPayout,
      id: position.id,
      payout: won ? position.grossPayout : 0,
      placedAt: position.placedAt,
      result: won ? "won" : "lost",
      roundId: position.roundId,
      settledAt,
      stake: position.stake,
    })
  }
  const roundId = allocateId(settled, dependencies)
  return {
    ...settled,
    marketHistory: [...settled.marketHistory, ...archived],
    positions: settled.positions.filter(
      (position) => !("kind" in position && position.kind === "market"),
    ),
    round: { id: roundId, openedAt: settledAt, status: "open" },
    settledRoundIds: [...settled.settledRoundIds, action.roundId],
  }
}

export function selectMarketHistory(state: DemoState): DemoState["marketHistory"] {
  return state.marketHistory
}

export function selectMarketRoundHistory(state: DemoState): readonly MarketRoundHistory[] {
  const roundIds = [...new Set(state.marketHistory.map((position) => position.roundId))]
  return roundIds.map((roundId) => {
    const positions = state.marketHistory.filter((position) => position.roundId === roundId)
    return {
      positions,
      roundId,
      totalPayout: positions.reduce((total, position) => total + position.payout, 0),
      totalStake: positions.reduce((total, position) => total + position.stake, 0),
    }
  })
}
