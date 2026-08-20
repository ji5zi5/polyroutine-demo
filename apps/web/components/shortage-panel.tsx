export type ShortageModel = {
  readonly nextRefreshAt: string
  readonly reason: "eligible_pool_exhausted"
  readonly requested: 5
  readonly returned: number
}

type ShortagePanelProps = {
  readonly shortage: ShortageModel | null
}

const serverRefreshTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
})

function formatRefreshTime(value: string): string {
  return `${serverRefreshTimeFormatter.format(new Date(value))} UTC`
}

export function ShortagePanel({ shortage }: ShortagePanelProps) {
  if (shortage === null) {
    return <p className="formHelper">지금 5개의 카드가 준비되어 있어요.</p>
  }

  return (
    <p className="shortagePanel">
      {shortage.returned === 0
        ? `새 루틴은 ${formatRefreshTime(shortage.nextRefreshAt)}에 확인할 수 있어요.`
        : `오늘 참여할 수 있는 루틴 ${shortage.returned}개를 준비했어요.`}
    </p>
  )
}
