import type { ReactNode } from "react"

type NoticeProps = {
  readonly announce?: boolean
  readonly children: ReactNode
  readonly kind: "error" | "info" | "success"
}

const classNames = {
  error: "notice noticeError",
  info: "notice noticeInfo",
  success: "notice noticeSuccess",
} as const

export function Notice({ announce = false, children, kind }: NoticeProps) {
  const role = announce ? (kind === "error" ? "alert" : "status") : undefined
  return (
    <div className={classNames[kind]} role={role}>
      {children}
    </div>
  )
}
