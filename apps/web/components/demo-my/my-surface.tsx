"use client"

import { useEffect, useRef, useState } from "react"
import { couponCatalog } from "../../lib/demo-coupons"
import { nicknameDisplayLines, parseNicknameInput } from "../../lib/demo-my/auth-input"
import type { MySummary } from "../../lib/demo-my/my-view-model"
import { PortfolioHistory } from "../demo-market/portfolio-history"
import { TransactionHistory } from "../demo-points/transaction-history"
import { CouponDetailDialog } from "../demo-shop/demo-shop-surface"
import styles from "./demo-my.module.css"
import { MyCouponHistory } from "./my-coupon-history"

type MySurfaceProps = Readonly<{
  balance: number
  email: string
  nickname: string
  onLogout: () => void
  onReset: () => void
  onUpdateNickname: (nickname: string) => void
  onUseCoupon: (couponId: string) => void
  summary: MySummary
}>

const points = new Intl.NumberFormat("ko-KR")

export function MySurface(props: MySurfaceProps) {
  const editDialogRef = useRef<HTMLDialogElement>(null)
  const editTriggerRef = useRef<HTMLButtonElement>(null)
  const nicknameInputRef = useRef<HTMLInputElement>(null)
  const resetDialogRef = useRef<HTMLDialogElement>(null)
  const resetTriggerRef = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState("")
  const [nicknameError, setNicknameError] = useState("")
  const [resetting, setResetting] = useState(false)
  const [selectedCouponId, setSelectedCouponId] = useState<string | null>(null)
  const [couponMode, setCouponMode] = useState<"confirm-use" | "detail">("detail")

  const selectedCoupon = [...props.summary.availableCoupons, ...props.summary.usedCoupons].find(
    (coupon) => coupon.id === selectedCouponId,
  )
  const selectedCouponProduct =
    selectedCoupon === undefined
      ? undefined
      : couponCatalog.find((product) => product.id === selectedCoupon.catalogId)

  useEffect(() => {
    if (editing && editDialogRef.current !== null && !editDialogRef.current.open) {
      editDialogRef.current.showModal()
      nicknameInputRef.current?.focus()
    }
  }, [editing])

  useEffect(() => {
    if (resetting && resetDialogRef.current !== null && !resetDialogRef.current.open) {
      resetDialogRef.current.showModal()
    }
  }, [resetting])

  const closeEdit = (): void => {
    setEditing(false)
    window.requestAnimationFrame(() => editTriggerRef.current?.focus())
  }
  const closeReset = (): void => {
    setResetting(false)
    window.requestAnimationFrame(() => resetTriggerRef.current?.focus())
  }
  const nicknameLines = nicknameDisplayLines(props.nickname)
  const firstNicknameLine = nicknameLines[0] ?? props.nickname
  const secondNicknameLine = nicknameLines[1]

  return (
    <>
      <section className={styles["profile"]}>
        <span aria-hidden="true" className={styles["avatar"]}>
          {props.nickname.charAt(0) || "P"}
        </span>
        <div>
          <h2 aria-label={props.nickname}>
            <span>{firstNicknameLine}</span>
            {secondNicknameLine === undefined ? null : <span>{secondNicknameLine}</span>}
          </h2>
          <p>{props.email}</p>
        </div>
        <button
          className={styles["quietAction"]}
          onClick={() => {
            setNicknameDraft(props.nickname)
            setNicknameError("")
            setEditing(true)
          }}
          ref={editTriggerRef}
          type="button"
        >
          닉네임 변경
        </button>
      </section>
      <dl className={styles["summary"]}>
        <div>
          <dt>등록한 목표</dt>
          <dd>{props.summary.goalCount}개</dd>
        </div>
        <div>
          <dt>예측</dt>
          <dd>
            진행 {props.summary.pendingPredictionCount} · 정산{" "}
            {props.summary.settledPredictionCount}
          </dd>
        </div>
        <div>
          <dt>포인트</dt>
          <dd>
            {points.format(props.balance)}P · {props.summary.ledgerEntryCount}건
          </dd>
        </div>
        <div>
          <dt>쿠폰</dt>
          <dd>
            사용 가능 {props.summary.availableCouponCount} · 사용 {props.summary.usedCouponCount}
          </dd>
        </div>
      </dl>
      <section aria-label="내 활동 내역" className={styles["histories"]}>
        <TransactionHistory transactions={props.summary.pointTransactions} />
        <PortfolioHistory
          pendingPositions={props.summary.pendingPositions}
          rounds={props.summary.predictionRounds}
        />
        <MyCouponHistory
          available={props.summary.availableCoupons}
          onSelectCoupon={(coupon) => {
            setCouponMode("detail")
            setSelectedCouponId(coupon.id)
          }}
          used={props.summary.usedCoupons}
        />
      </section>
      <div className={styles["accountActions"]}>
        <button className={styles["quietFullAction"]} onClick={props.onLogout} type="button">
          로그아웃
        </button>
        <button
          className={styles["resetAction"]}
          onClick={() => setResetting(true)}
          ref={resetTriggerRef}
          type="button"
        >
          데이터 초기화
        </button>
      </div>
      {editing ? (
        <dialog
          aria-labelledby="nickname-dialog-title"
          className={styles["dialog"]}
          onCancel={(event) => {
            event.preventDefault()
            closeEdit()
          }}
          ref={editDialogRef}
        >
          <h2 id="nickname-dialog-title">닉네임 변경</h2>
          <label className={styles["field"]}>
            <span>새 닉네임</span>
            <input
              aria-describedby={nicknameError === "" ? undefined : "nickname-edit-feedback"}
              aria-invalid={nicknameError === "" ? undefined : true}
              maxLength={16}
              onChange={(event) => {
                setNicknameDraft(event.target.value)
                setNicknameError("")
              }}
              ref={nicknameInputRef}
              value={nicknameDraft}
            />
            {nicknameError === "" ? null : (
              <small id="nickname-edit-feedback">{nicknameError}</small>
            )}
          </label>
          <div className={styles["dialogActions"]}>
            <button className={styles["quietAction"]} onClick={closeEdit} type="button">
              취소
            </button>
            <button
              className={styles["primaryAction"]}
              onClick={() => {
                const result = parseNicknameInput(nicknameDraft)
                if (result.kind === "invalid") {
                  setNicknameError(result.error)
                  return
                }
                props.onUpdateNickname(result.nickname)
                closeEdit()
              }}
              type="button"
            >
              저장
            </button>
          </div>
        </dialog>
      ) : null}
      {resetting ? (
        <dialog
          aria-labelledby="reset-dialog-title"
          className={styles["dialog"]}
          onCancel={(event) => {
            event.preventDefault()
            closeReset()
          }}
          ref={resetDialogRef}
        >
          <h2 id="reset-dialog-title">모든 데이터를 초기화할까요?</h2>
          <p>프로필, 목표, 포인트와 예측 기록만 지워져요.</p>
          <div className={styles["dialogActions"]}>
            <button className={styles["quietAction"]} onClick={closeReset} type="button">
              취소
            </button>
            <button className={styles["primaryAction"]} onClick={props.onReset} type="button">
              초기화하기
            </button>
          </div>
        </dialog>
      ) : null}
      {selectedCoupon === undefined || selectedCouponProduct === undefined ? null : (
        <CouponDetailDialog
          coupon={selectedCoupon}
          mode={couponMode}
          onClose={() => setSelectedCouponId(null)}
          onConfirmUse={() => {
            props.onUseCoupon(selectedCoupon.id)
            setSelectedCouponId(null)
          }}
          onRequestUse={() => setCouponMode("confirm-use")}
          product={selectedCouponProduct}
        />
      )}
    </>
  )
}
