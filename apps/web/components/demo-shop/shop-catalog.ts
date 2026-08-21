import { createElement as h } from "react"
import type { CouponInstance, RewardProduct } from "../../lib/demo-coupons/index"
import { couponCatalog, selectCouponOwnership } from "../../lib/demo-coupons/index"
import styles from "./demo-shop.module.css"
import { ShopImage } from "./shop-image"

type ShopCatalogProps = Readonly<{
  balance: number
  coupons: readonly CouponInstance[]
  onSelectProduct: (product: RewardProduct) => void
}>

const points = new Intl.NumberFormat("ko-KR")

function styleClass(name: string): string {
  return styles[name] ?? ""
}

export function ShopCatalog({ balance, coupons, onSelectProduct }: ShopCatalogProps) {
  const ownership = selectCouponOwnership(couponCatalog, coupons)
  return h(
    "section",
    { "aria-labelledby": "demo-shop-title", className: styleClass("shop") },
    h(
      "header",
      { className: styleClass("shopHeader") },
      h(
        "div",
        null,
        h("h2", { id: "demo-shop-title" }, "포인트 상점"),
        h("p", null, "예측으로 모은 포인트를 사용할 수 있어요."),
      ),
      h(
        "strong",
        { "aria-label": `보유 포인트 ${points.format(balance)}P` },
        `${points.format(balance)}P`,
      ),
    ),
    h(
      "div",
      { className: styleClass("grid") },
      ...ownership.map(({ owned, product }) =>
        h(
          "article",
          {
            className: styleClass("product"),
            "data-shop-product": product.id,
            key: product.id,
          },
          h(ShopImage, { product }),
          h(
            "div",
            { className: styleClass("productCopy") },
            h("h3", null, product.name),
            h("span", null, owned === 0 ? "아직 보유하지 않았어요" : `보유 ${owned}개`),
          ),
          h(
            "button",
            {
              "aria-label": `${product.name} ${points.format(product.cost)}P로 구매`,
              className: styleClass("primaryButton"),
              "data-shop-purchase": product.id,
              onClick: () => onSelectProduct(product),
              type: "button",
            },
            `${points.format(product.cost)}P`,
          ),
        ),
      ),
    ),
  )
}
