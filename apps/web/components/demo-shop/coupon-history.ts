import { createElement as h } from "react"
import type { CouponInstance, RewardProduct } from "../../lib/demo-coupons/index"
import { selectAvailableCoupons, selectUsedCoupons } from "../../lib/demo-coupons/index"
import styles from "./demo-shop.module.css"
import { ShopImage } from "./shop-image"

type CouponHistoryProps = Readonly<{
  coupons: readonly CouponInstance[]
  onSelectCoupon: (coupon: CouponInstance) => void
  products: readonly RewardProduct[]
}>

function styleClass(name: string): string {
  return styles[name] ?? ""
}

function CouponRows({
  coupons,
  onSelectCoupon,
  products,
}: Readonly<{
  coupons: readonly CouponInstance[]
  onSelectCoupon: (coupon: CouponInstance) => void
  products: readonly RewardProduct[]
}>) {
  if (coupons.length === 0) return h("p", { className: styleClass("empty") }, "해당 쿠폰이 없어요.")
  return h(
    "ul",
    { className: styleClass("historyList") },
    ...coupons.map((coupon) => {
      const product = products.find((candidate) => candidate.id === coupon.catalogId)
      return h(
        "li",
        { "data-coupon-id": coupon.id, key: coupon.id },
        h(
          "button",
          { onClick: () => onSelectCoupon(coupon), type: "button" },
          product === undefined ? null : h(ShopImage, { product }),
          h(
            "span",
            null,
            h("strong", null, coupon.label),
            h("small", null, coupon.usedAt === null ? "사용 가능" : "사용 완료"),
          ),
        ),
      )
    }),
  )
}

export function CouponHistory({ coupons, onSelectCoupon, products }: CouponHistoryProps) {
  const available = selectAvailableCoupons(coupons)
  const used = selectUsedCoupons(coupons)
  return h(
    "section",
    { "aria-labelledby": "coupon-history-title", className: styleClass("history") },
    h("h2", { id: "coupon-history-title" }, "내 쿠폰"),
    h(
      "details",
      { "data-coupon-group": "available", open: true },
      h("summary", null, `사용 가능 ${available.length}개`),
      h(CouponRows, { coupons: available, onSelectCoupon, products }),
    ),
    h(
      "details",
      { "data-coupon-group": "used" },
      h("summary", null, `사용한 쿠폰 ${used.length}개`),
      h(CouponRows, { coupons: used, onSelectCoupon, products }),
    ),
  )
}
