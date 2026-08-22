import type { CouponInstance } from "../../lib/demo-coupons"
import styles from "./demo-my.module.css"

type MyCouponHistoryProps = Readonly<{
  available: readonly CouponInstance[]
  onSelectCoupon: (coupon: CouponInstance) => void
  used: readonly CouponInstance[]
}>

function CouponRows({
  coupons,
  onSelectCoupon,
}: Readonly<{
  coupons: readonly CouponInstance[]
  onSelectCoupon: (coupon: CouponInstance) => void
}>) {
  return (
    <ul className={styles["historyList"]}>
      {coupons.map((coupon) => (
        <li data-coupon-id={coupon.id} key={coupon.id}>
          <button onClick={() => onSelectCoupon(coupon)} type="button">
            <strong>{coupon.label}</strong>
            <span>{coupon.usedAt === null ? "사용 가능" : "사용 완료"}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function MyCouponHistory({ available, onSelectCoupon, used }: MyCouponHistoryProps) {
  if (available.length + used.length === 0) return null
  return (
    <details className={styles["history"]}>
      <summary>
        <span>
          <strong>쿠폰 내역</strong>
          <small>{available.length + used.length}개</small>
        </span>
        <span aria-hidden="true">보기</span>
      </summary>
      <div className={styles["couponGroups"]}>
        {available.length === 0 ? null : (
          <section aria-labelledby="my-available-coupons">
            <h3 id="my-available-coupons">사용 가능 {available.length}개</h3>
            <CouponRows coupons={available} onSelectCoupon={onSelectCoupon} />
          </section>
        )}
        {used.length === 0 ? null : (
          <section aria-labelledby="my-used-coupons">
            <h3 id="my-used-coupons">사용한 쿠폰 {used.length}개</h3>
            <CouponRows coupons={used} onSelectCoupon={onSelectCoupon} />
          </section>
        )}
      </div>
    </details>
  )
}
