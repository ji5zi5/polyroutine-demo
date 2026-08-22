import { createElement as h } from "react"
import type { RewardProduct } from "../../lib/demo-coupons/index"
import { couponCatalog } from "../../lib/demo-coupons/index"
import styles from "./demo-shop.module.css"
import { ShopImage } from "./shop-image"

type ShopCatalogProps = Readonly<{
  balance: number
  onSelectProduct: (product: RewardProduct) => void
}>

const points = new Intl.NumberFormat("ko-KR")

function styleClass(name: string): string {
  return styles[name] ?? ""
}

export function ShopCatalog({ balance, onSelectProduct }: ShopCatalogProps) {
  return h(
    "section",
    { "aria-labelledby": "demo-shop-title", className: styleClass("shop") },
    h(
      "header",
      { className: styleClass("shopHeader") },
      h("div", null, h("h2", { id: "demo-shop-title" }, "포인트 상점")),
      h(
        "strong",
        { "aria-label": `보유 포인트 ${points.format(balance)}P` },
        `${points.format(balance)}P`,
      ),
    ),
    h(
      "div",
      { className: styleClass("grid") },
      ...couponCatalog.map((product) =>
        h(
          "article",
          {
            className: styleClass("product"),
            "data-shop-product": product.id,
            key: product.id,
          },
          h(ShopImage, { product }),
          h("div", { className: styleClass("productCopy") }, h("h3", null, product.name)),
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
