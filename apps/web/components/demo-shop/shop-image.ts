import Image from "next/image"
import { createElement as h } from "react"
import type { RewardProduct } from "../../lib/demo-coupons/index"
import styles from "./demo-shop.module.css"

function styleClass(name: string): string {
  return styles[name] ?? ""
}

export function ShopImage({ product }: { readonly product: RewardProduct }) {
  return h(
    "span",
    { className: styleClass("image") },
    h(Image, {
      alt: product.name,
      height: 320,
      sizes: "(max-width: 640px) 42vw, 160px",
      src: product.imageSrc,
      unoptimized: true,
      width: 320,
    }),
  )
}
