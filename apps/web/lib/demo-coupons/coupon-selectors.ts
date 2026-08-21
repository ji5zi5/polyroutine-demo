import type { CouponInstance, RewardProduct } from "./coupon-types"

export type CouponOwnership = Readonly<{
  available: number
  owned: number
  product: RewardProduct
  used: number
}>

export function selectAvailableCoupons(
  coupons: readonly CouponInstance[],
): readonly CouponInstance[] {
  return coupons.filter((coupon) => coupon.usedAt === null)
}

export function selectUsedCoupons(coupons: readonly CouponInstance[]): readonly CouponInstance[] {
  return coupons.filter((coupon) => coupon.usedAt !== null)
}

export function selectCouponOwnership(
  products: readonly RewardProduct[],
  coupons: readonly CouponInstance[],
): readonly CouponOwnership[] {
  return products.map((product) => {
    const owned = coupons.filter((coupon) => coupon.catalogId === product.id)
    const available = owned.filter((coupon) => coupon.usedAt === null).length
    return {
      available,
      owned: owned.length,
      product,
      used: owned.length - available,
    }
  })
}
