import type { CouponInstance } from "../../lib/demo-coupons"
import styles from "./demo-my.module.css"

type MyCouponHistoryProps = Readonly<{
  available: readonly CouponInstance[]
  used: readonly CouponInstance[]
}>

function CouponRows({ coupons }: Readonly<{ coupons: readonly CouponInstance[] }>) {
  if (coupons.length === 0) return <p className={styles["emptyHistory"]}>해당 쿠폰이 없어요.</p>
  return (
    <ul className={styles["historyList"]}>
      {coupons.map((coupon) => (
        <li key={coupon.id}>
          <strong>{coupon.label}</strong>
          <span>{coupon.usedAt === null ? "사용 가능" : "사용 완료"}</span>
        </li>
      ))}
    </ul>
  )
}

export function MyCouponHistory({ available, used }: MyCouponHistoryProps) {
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
        <section aria-labelledby="my-available-coupons">
          <h3 id="my-available-coupons">사용 가능 {available.length}개</h3>
          <CouponRows coupons={available} />
        </section>
        <section aria-labelledby="my-used-coupons">
          <h3 id="my-used-coupons">사용한 쿠폰 {used.length}개</h3>
          <CouponRows coupons={used} />
        </section>
      </div>
    </details>
  )
}
