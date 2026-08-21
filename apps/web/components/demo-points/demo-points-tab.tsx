"use client"

import { useEffect, useRef, useState } from "react"
import {
  type CouponInstance,
  couponCatalog,
  type RewardProduct,
} from "../../lib/demo-coupons/index"
import type {
  DemoAction,
  DemoState,
  MarketPosition,
  MarketRoundHistory,
} from "../../lib/demo-state/index"
import { PortfolioHistory } from "../demo-market/portfolio-history"
import {
  CouponDetailDialog,
  CouponHistory,
  PurchaseCouponDialog,
  ShopCatalog,
} from "../demo-shop/demo-shop-surface"
import { DemoPointsSurface } from "./demo-points-surface"

type DemoPointsTabProps = Readonly<{
  now: Date
  onDispatch: (action: DemoAction) => void
  pendingPositions: readonly MarketPosition[]
  rounds: readonly MarketRoundHistory[]
  state: DemoState
}>

type CouponDialogState = Readonly<{
  couponId: string
  mode: "confirm-use" | "detail"
}>

export function DemoPointsTab({
  now,
  onDispatch,
  pendingPositions,
  rounds,
  state,
}: DemoPointsTabProps) {
  const purchaseLocked = useRef(false)
  const useLocked = useRef(false)
  const [attendanceOpen, setAttendanceOpen] = useState(false)
  const [couponDialog, setCouponDialog] = useState<CouponDialogState | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<RewardProduct | null>(null)
  const [settlementFeedback, setSettlementFeedback] = useState<number | null>(null)

  const selectedCoupon =
    couponDialog === null
      ? undefined
      : state.coupons.find((coupon) => coupon.id === couponDialog.couponId)
  const selectedCouponProduct =
    selectedCoupon === undefined
      ? undefined
      : couponCatalog.find((product) => product.id === selectedCoupon.catalogId)

  useEffect(() => {
    if (settlementFeedback === null) return
    const timer = window.setTimeout(() => setSettlementFeedback(null), 800)
    return () => window.clearTimeout(timer)
  }, [settlementFeedback])

  const openCoupon = (coupon: CouponInstance): void => {
    useLocked.current = false
    setCouponDialog({ couponId: coupon.id, mode: "detail" })
  }

  return (
    <>
      <DemoPointsSurface
        attendanceDialogOpen={attendanceOpen}
        now={now}
        onClaimAttendance={(action) => {
          onDispatch(action)
          setAttendanceOpen(false)
        }}
        onCloseAttendance={() => setAttendanceOpen(false)}
        onOpenAttendance={() => setAttendanceOpen(true)}
        settled={settlementFeedback !== null}
        state={state}
      />
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
              settlementFeedback === null ? "buttonQuiet" : "buttonQuiet settlementFeedbackButton"
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
              onDispatch({ roundId: state.round.id, type: "settle_market_round" })
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
      <ShopCatalog
        balance={state.balance}
        coupons={state.coupons}
        onSelectProduct={(product) => {
          purchaseLocked.current = false
          setSelectedProduct(product)
        }}
      />
      <CouponHistory coupons={state.coupons} onSelectCoupon={openCoupon} products={couponCatalog} />
      {selectedProduct === null ? null : (
        <PurchaseCouponDialog
          balance={state.balance}
          onClose={() => setSelectedProduct(null)}
          onConfirm={() => {
            if (purchaseLocked.current) return
            purchaseLocked.current = true
            onDispatch({
              catalogId: selectedProduct.id,
              cost: selectedProduct.cost,
              label: selectedProduct.name,
              type: "purchase_coupon",
            })
            setSelectedProduct(null)
          }}
          product={selectedProduct}
        />
      )}
      {selectedCoupon === undefined ||
      selectedCouponProduct === undefined ||
      couponDialog === null ? null : (
        <CouponDetailDialog
          coupon={selectedCoupon}
          mode={couponDialog.mode}
          onClose={() => setCouponDialog(null)}
          onConfirmUse={() => {
            if (useLocked.current) return
            useLocked.current = true
            onDispatch({ couponId: selectedCoupon.id, type: "use_coupon" })
            setCouponDialog(null)
            window.requestAnimationFrame(() => {
              document
                .querySelector<HTMLElement>('details[data-coupon-group="used"] > summary')
                ?.focus()
            })
          }}
          onRequestUse={() => setCouponDialog({ couponId: selectedCoupon.id, mode: "confirm-use" })}
          product={selectedCouponProduct}
        />
      )}
    </>
  )
}
