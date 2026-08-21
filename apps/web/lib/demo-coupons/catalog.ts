import { z } from "zod"
import { rewardProductSchema } from "./coupon-types"

const rewardCatalogSchema = z
  .array(rewardProductSchema)
  .length(8)
  .superRefine((products, context) => {
    for (const key of ["id", "imageSrc"] as const) {
      const values = products.map((product) => product[key])
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: `duplicate ${key}`, path: [key] })
      }
    }
  })
  .readonly()

export const couponCatalog = rewardCatalogSchema.parse([
  {
    cost: 50_000,
    id: "convenience",
    imageSrc: "/rewards/gs25-1000.jpg",
    name: "GS25 모바일 상품권 1천원권",
  },
  {
    cost: 200_000,
    id: "americano",
    imageSrc: "/rewards/americano-coupon.png",
    name: "아이스 아메리카노",
  },
  {
    cost: 260_000,
    id: "starbucks-latte",
    imageSrc: "/rewards/starbucks-latte.jpg",
    name: "스타벅스 아이스 카페 라떼T",
  },
  {
    cost: 120_000,
    id: "mcdonald-sundae",
    imageSrc: "/rewards/mcdonald-sundae.jpg",
    name: "맥도날드 초코 선데이",
  },
  {
    cost: 500_000,
    id: "naverpay-10000",
    imageSrc: "/rewards/naverpay-10000.jpg",
    name: "네이버페이 포인트 10,000원",
  },
  {
    cost: 50_000,
    id: "oliveyoung-1000",
    imageSrc: "/rewards/oliveyoung-1000.png",
    name: "올리브영 모바일 상품권 1,000원",
  },
  {
    cost: 250_000,
    id: "shinsegae-5000",
    imageSrc: "/rewards/shinsegae-5000.jpg",
    name: "신세계상품권 5천원권",
  },
  {
    cost: 1_500_000,
    id: "baskin-30000",
    imageSrc: "/rewards/baskin-30000.jpg",
    name: "배스킨라빈스 교환권 30,000원",
  },
])
