"use client"

import type { SyntheticEvent } from "react"
import { createElement as h } from "react"
import type { CouponInstance, RewardProduct } from "../../lib/demo-coupons/index"
import styles from "./demo-shop.module.css"
import { ShopImage } from "./shop-image"
import { useModalDialog } from "./use-modal-dialog"

const points = new Intl.NumberFormat("ko-KR")
const dateTime = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
})

function styleClass(name: string): string {
  return styles[name] ?? ""
}

function shortage(product: RewardProduct, balance: number): string {
  return `가격 ${points.format(product.cost)}P · 보유 ${points.format(balance)}P · 부족 ${points.format(product.cost - balance)}P`
}

type PurchaseCouponDialogProps = Readonly<{
  balance: number
  onClose: () => void
  onConfirm: () => void
  product: RewardProduct
}>

export function PurchaseCouponDialog({
  balance,
  onClose,
  onConfirm,
  product,
}: PurchaseCouponDialogProps) {
  const insufficient = balance < product.cost
  const dialogRef = useModalDialog()
  return h(
    "dialog",
    {
      "aria-labelledby": "purchase-coupon-title",
      className: styleClass("dialog"),
      "data-demo-dialog": "coupon",
      onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault()
        onClose()
      },
      ref: dialogRef,
    },
    h(ShopImage, { product }),
    h(
      "div",
      { className: styleClass("dialogCopy") },
      h("h2", { id: "purchase-coupon-title" }, product.name),
      insufficient
        ? h(
            "p",
            { "aria-live": "polite", className: styleClass("shortage"), role: "alert" },
            shortage(product, balance),
          )
        : h(
            "p",
            null,
            `${points.format(product.cost)}P를 사용하면 ${points.format(balance - product.cost)}P가 남아요.`,
          ),
    ),
    h(
      "div",
      { className: styleClass("dialogActions") },
      h(
        "button",
        { className: styleClass("secondaryButton"), onClick: onClose, type: "button" },
        "취소",
      ),
      h(
        "button",
        {
          className: styleClass("primaryButton"),
          disabled: insufficient,
          onClick: onConfirm,
          type: "button",
        },
        insufficient ? "포인트가 부족해요" : "구매하기",
      ),
    ),
  )
}

type CouponDetailDialogProps = Readonly<{
  coupon: CouponInstance
  mode: "confirm-use" | "detail"
  onClose: () => void
  onConfirmUse: () => void
  onRequestUse: () => void
  product: RewardProduct
}>

export function CouponDetailDialog({
  coupon,
  mode,
  onClose,
  onConfirmUse,
  onRequestUse,
  product,
}: CouponDetailDialogProps) {
  const used = coupon.usedAt !== null
  const dialogRef = useModalDialog()
  return h(
    "dialog",
    {
      "aria-labelledby": "coupon-detail-title",
      className: styleClass("dialog"),
      "data-demo-dialog": "coupon",
      onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault()
        onClose()
      },
      ref: dialogRef,
    },
    h(ShopImage, { product }),
    h(
      "div",
      { className: styleClass("dialogCopy") },
      h("span", { className: styleClass("status") }, used ? "사용 완료" : "사용 가능"),
      h("h2", { id: "coupon-detail-title" }, coupon.label),
      h("p", null, `구매 ${dateTime.format(new Date(coupon.purchasedAt))}`),
      used && coupon.usedAt !== null
        ? h("p", null, `사용 ${dateTime.format(new Date(coupon.usedAt))}`)
        : null,
      mode === "confirm-use" && !used ? h("strong", null, "이 쿠폰을 사용 처리할까요?") : null,
    ),
    h(
      "div",
      { className: styleClass("dialogActions") },
      h(
        "button",
        { className: styleClass("secondaryButton"), onClick: onClose, type: "button" },
        "닫기",
      ),
      used
        ? null
        : h(
            "button",
            {
              className: styleClass("primaryButton"),
              onClick: mode === "confirm-use" ? onConfirmUse : onRequestUse,
              type: "button",
            },
            mode === "confirm-use" ? "사용 확정하기" : "사용하기",
          ),
    ),
  )
}
