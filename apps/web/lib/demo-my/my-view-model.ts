import { selectAvailableCoupons, selectUsedCoupons } from "../demo-coupons"
import { selectPointTransactions } from "../demo-points/points-view-model"
import {
  type DemoState,
  selectMarketHistory,
  selectMarketRoundHistory,
  selectPendingMarketPositions,
} from "../demo-state"

export type MySummary = Readonly<{
  availableCouponCount: number
  availableCoupons: DemoState["coupons"]
  goalCount: number
  ledgerEntryCount: number
  pendingPredictionCount: number
  pendingPositions: ReturnType<typeof selectPendingMarketPositions>
  pointTransactions: ReturnType<typeof selectPointTransactions>
  predictionRounds: ReturnType<typeof selectMarketRoundHistory>
  settledPredictionCount: number
  usedCouponCount: number
  usedCoupons: DemoState["coupons"]
}>

export function selectMySummary(state: DemoState): MySummary {
  const availableCoupons = selectAvailableCoupons(state.coupons)
  const usedCoupons = selectUsedCoupons(state.coupons)
  const pendingPositions = selectPendingMarketPositions(state)
  const settledPositions = selectMarketHistory(state)
  return {
    availableCouponCount: availableCoupons.length,
    availableCoupons,
    goalCount: state.goals.length,
    ledgerEntryCount: state.ledger.length,
    pendingPredictionCount: pendingPositions.length,
    pendingPositions,
    pointTransactions: selectPointTransactions(state),
    predictionRounds: selectMarketRoundHistory(state),
    settledPredictionCount: settledPositions.length,
    usedCouponCount: usedCoupons.length,
    usedCoupons,
  }
}
