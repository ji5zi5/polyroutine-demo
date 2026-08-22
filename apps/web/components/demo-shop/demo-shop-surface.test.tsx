import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  useCoupon as applyCouponUse,
  couponCatalog,
  purchaseCoupon,
} from "../../lib/demo-coupons/index"
import {
  CouponDetailDialog,
  CouponHistory,
  PurchaseCouponDialog,
  ShopCatalog,
} from "./demo-shop-surface"

const now = new Date("2026-08-21T01:02:03.000Z")

function nextId(...values: readonly string[]) {
  let index = 0
  return () => {
    const value = values[index]
    index += 1
    if (value === undefined) throw new TypeError("No deterministic component fixture ID remains")
    return value
  }
}

function fixtureCoupons() {
  const product = couponCatalog[0]
  if (product === undefined) throw new TypeError("Expected the fixed coupon catalog")
  const first = purchaseCoupon(
    { balance: 120_000, coupons: [], ledgerEventIds: [], product },
    { nextId: nextId("coupon-a", "debit-a"), now: () => now },
  )
  if (first.kind !== "purchased") throw new TypeError("Expected first fixture coupon")
  const second = purchaseCoupon(
    {
      balance: first.balanceAfter,
      coupons: [first.coupon],
      ledgerEventIds: [first.debit.id],
      product,
    },
    { nextId: nextId("coupon-b", "debit-b"), now: () => now },
  )
  if (second.kind !== "purchased") throw new TypeError("Expected second fixture coupon")
  const used = applyCouponUse(
    { balance: second.balanceAfter, couponId: first.coupon.id, coupons: [first.coupon] },
    { nextId: nextId("use-a"), now: () => now },
  )
  if (used.kind !== "used") throw new TypeError("Expected used fixture coupon")
  return { available: second.coupon, product, used: used.coupon }
}

describe("isolated demo shop surfaces", () => {
  it("renders eight expensive products with non-disabled primary purchase actions", () => {
    // Given: the fixed catalog

    // When: the catalog surface renders at a low balance
    const html = renderToStaticMarkup(
      createElement(ShopCatalog, {
        balance: 10,
        onSelectProduct: () => {},
      }),
    )

    // Then: all products remain inspectable without wallet details
    expect((html.match(/data-shop-product=/g) ?? []).length).toBe(8)
    expect((html.match(/data-shop-purchase=/g) ?? []).length).toBe(8)
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain("보유 2개")
    expect(html).not.toContain("아직 보유하지 않았어요")
    expect(html).not.toContain("예측으로 모은 포인트를 사용할 수 있어요")
    for (const product of couponCatalog) {
      expect(html).toContain(`alt="${product.name}"`)
      expect(html).toContain(`${product.cost.toLocaleString("ko-KR")}P`)
    }
  })

  it("renders exact insufficient context and a two-step use confirmation without fulfillment claims", () => {
    // Given: one available coupon and a balance below its price
    const fixture = fixtureCoupons()

    // When: purchase and use-confirmation dialogs render
    const purchaseHtml = renderToStaticMarkup(
      createElement(PurchaseCouponDialog, {
        balance: 49_999,
        onClose: () => {},
        onConfirm: () => {},
        product: fixture.product,
      }),
    )
    const detailHtml = renderToStaticMarkup(
      createElement(CouponDetailDialog, {
        coupon: fixture.available,
        mode: "confirm-use",
        onClose: () => {},
        onConfirmUse: () => {},
        onRequestUse: () => {},
        product: fixture.product,
      }),
    )

    // Then: exact points are announced and explicit use is truthful and actionable
    expect(purchaseHtml).toContain("가격 50,000P · 보유 49,999P · 부족 1P")
    expect(purchaseHtml).toContain('disabled=""')
    expect(detailHtml).toContain("이 쿠폰을 사용 처리할까요?")
    expect(detailHtml).toContain("사용 확정하기")
    expect(detailHtml).not.toContain("데모 쿠폰")
    expect(detailHtml).not.toMatch(/바코드|실물|배송|제휴 API/)
  })

  it("keeps available and used coupon instances in separate accessible histories", () => {
    // Given: one available and one used instance of the same product
    const fixture = fixtureCoupons()

    // When: the wallet history surface renders
    const html = renderToStaticMarkup(
      createElement(CouponHistory, {
        coupons: [fixture.available, fixture.used],
        onSelectCoupon: () => {},
        products: couponCatalog,
      }),
    )

    // Then: both instances remain visible and individually addressable
    expect(html).toContain("사용 가능 1개")
    expect(html).toContain("사용한 쿠폰 1개")
    expect(html).toContain('data-coupon-id="coupon-a"')
    expect(html).toContain('data-coupon-id="coupon-b"')
  })

  it("references eight readable nonblank local reward assets with accessible names", async () => {
    // Given: every image referenced by the catalog
    const publicRoot = path.resolve(import.meta.dirname, "../../public")

    // When: the asset files are read directly from the public bundle
    const assets = await Promise.all(
      couponCatalog.map(async (product) => {
        const assetPath = path.join(publicRoot, product.imageSrc)
        const [metadata, bytes] = await Promise.all([stat(assetPath), readFile(assetPath)])
        return { bytes, metadata, product }
      }),
    )

    // Then: every rendered image has a real non-empty payload and a nonblank accessible name
    expect(assets).toHaveLength(8)
    for (const { bytes, metadata, product } of assets) {
      expect(product.name.trim().length).toBeGreaterThan(0)
      expect(product.imageSrc.startsWith("/rewards/")).toBe(true)
      expect(metadata.isFile()).toBe(true)
      expect(metadata.size).toBeGreaterThan(10_000)
      expect(new Set(bytes.subarray(0, Math.min(bytes.length, 4_096))).size).toBeGreaterThan(16)
    }
    expect(Math.min(...couponCatalog.map((product) => product.cost))).toBeGreaterThanOrEqual(50_000)
  })

  it("uses the existing design tokens without one-off color or length literals", async () => {
    // Given: the isolated shop stylesheet governed by DESIGN.md
    const stylesheetPath = path.resolve(import.meta.dirname, "demo-shop.module.css")

    // When: the stylesheet is inspected as a machine-consumed CSS artifact
    const stylesheet = await readFile(stylesheetPath, "utf8")

    // Then: product styling is expressed through the shared token contract
    expect(stylesheet).not.toMatch(/#[0-9a-f]{3,8}|(?:rgb|hsl|oklch)\(/i)
    expect(stylesheet).not.toMatch(/\b\d+(?:\.\d+)?(?:px|rem|em)\b/i)
    expect(stylesheet).toContain("var(--accent-primary)")
    expect(stylesheet).toContain("var(--target-min)")
  })
})
