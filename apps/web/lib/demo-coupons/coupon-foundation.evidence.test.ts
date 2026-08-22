import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  CouponDetailDialog,
  CouponHistory,
  PurchaseCouponDialog,
  ShopCatalog,
} from "../../components/demo-shop/demo-shop-surface.js"
import {
  couponCatalog,
  purchaseCoupon,
  selectAvailableCoupons,
  selectUsedCoupons,
  useCoupon,
} from "./index.js"

function ids(...values: readonly string[]) {
  let index = 0
  return () => {
    const value = values[index]
    index += 1
    if (value === undefined) throw new TypeError("No evidence ID remains")
    return value
  }
}

describe("Task 10 foundation evidence", () => {
  // biome-ignore lint/complexity/useLiteralKeys: strict environment typing requires indexed access.
  it.skipIf(process.env["WRITE_TASK_10_EVIDENCE"] !== "true")(
    "records coupon policy component and asset artifacts",
    async () => {
      // Given: two deterministic purchases, one confirmed use, and one exact shortage
      const product = couponCatalog[0]
      if (product === undefined) throw new TypeError("Expected the fixed catalog")
      const first = purchaseCoupon(
        { balance: 120_000, coupons: [], ledgerEventIds: [], product },
        {
          nextId: ids("evidence-coupon-1", "evidence-debit-1"),
          now: () => new Date("2026-08-21T01:00:00.000Z"),
        },
      )
      if (first.kind !== "purchased") throw new TypeError("Expected first evidence purchase")
      const second = purchaseCoupon(
        {
          balance: first.balanceAfter,
          coupons: [first.coupon],
          ledgerEventIds: [first.debit.id],
          product,
        },
        {
          nextId: ids("evidence-coupon-2", "evidence-debit-2"),
          now: () => new Date("2026-08-21T01:01:00.000Z"),
        },
      )
      if (second.kind !== "purchased") throw new TypeError("Expected second evidence purchase")
      const used = useCoupon(
        {
          balance: second.balanceAfter,
          couponId: first.coupon.id,
          coupons: [first.coupon, second.coupon],
        },
        {
          nextId: ids("evidence-use-1"),
          now: () => new Date("2026-08-21T02:00:00.000Z"),
        },
      )
      if (used.kind !== "used") throw new TypeError("Expected evidence coupon use")
      const coupons = [used.coupon, second.coupon]
      const shortage = purchaseCoupon(
        { balance: 49_999, coupons, ledgerEventIds: [], product },
        { nextId: ids("unused"), now: () => new Date("2026-08-21T03:00:00.000Z") },
      )
      const evidenceDir = path.resolve(
        import.meta.dirname,
        "../../../../.omo/evidence/task-10-foundation",
      )
      const publicRoot = path.resolve(import.meta.dirname, "../../public")
      const assets = await Promise.all(
        couponCatalog.map(async (item) => {
          const assetPath = path.join(publicRoot, item.imageSrc)
          const [metadata, bytes] = await Promise.all([stat(assetPath), readFile(assetPath)])
          return {
            accessibleName: item.name,
            bytes: metadata.size,
            distinctPrefixBytes: new Set(bytes.subarray(0, Math.min(bytes.length, 4_096))).size,
            imageSrc: item.imageSrc,
          }
        }),
      )
      const policyMatrix = {
        availableIds: selectAvailableCoupons(coupons).map((coupon) => coupon.id),
        finalBalance: second.balanceAfter,
        repeatPurchases: [first, second].map((purchase) => ({
          couponId: purchase.coupon.id,
          debit: purchase.debit,
          purchasedAt: purchase.coupon.purchasedAt,
        })),
        shortage,
        use: {
          balanceAfter: used.balanceAfter,
          balanceBefore: used.balanceBefore,
          coupon: used.coupon,
        },
        usedIds: selectUsedCoupons(coupons).map((coupon) => coupon.id),
      }
      const html = [
        createElement(ShopCatalog, { balance: 20_000, onSelectProduct: () => {} }),
        createElement(PurchaseCouponDialog, {
          balance: 49_999,
          onClose: () => {},
          onConfirm: () => {},
          product,
        }),
        createElement(CouponDetailDialog, {
          coupon: second.coupon,
          mode: "confirm-use",
          onClose: () => {},
          onConfirmUse: () => {},
          onRequestUse: () => {},
          product,
        }),
        createElement(CouponHistory, {
          coupons,
          onSelectCoupon: () => {},
          products: couponCatalog,
        }),
      ].map((element) => renderToStaticMarkup(element))

      // When: the isolated foundation records reproducible inspection artifacts
      await mkdir(evidenceDir, { recursive: true })
      await Promise.all([
        writeFile(
          path.join(evidenceDir, "task-10-assets.json"),
          `${JSON.stringify(assets, null, 2)}\n`,
        ),
        writeFile(
          path.join(evidenceDir, "task-10-component-states.html"),
          `<!doctype html><html lang="ko"><body>${html.join("")}</body></html>`,
        ),
        writeFile(
          path.join(evidenceDir, "task-10-domain-matrix.json"),
          `${JSON.stringify(policyMatrix, null, 2)}\n`,
        ),
      ])

      // Then: the artifacts prove eight assets, two instances, one unchanged use balance, and shortage
      expect(assets).toHaveLength(8)
      expect(policyMatrix.repeatPurchases[0]?.couponId).not.toBe(
        policyMatrix.repeatPurchases[1]?.couponId,
      )
      expect(policyMatrix.use.balanceAfter).toBe(policyMatrix.use.balanceBefore)
      expect(shortage.kind).toBe("insufficient")
    },
  )
})
