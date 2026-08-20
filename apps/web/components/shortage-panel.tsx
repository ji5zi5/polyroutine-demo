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
    <section
      aria-label={
        shortage.returned === 0
          ? "참여 가능한 카드 없음"
          : `참여 가능한 카드 ${shortage.returned}개`
      }
      className="shortagePanel"
    >
      <div className="stackCompact">
        <h3>카드가 부족해요</h3>
        <p>
          {shortage.returned === 0
            ? "지금 참여할 익명 목표가 없습니다."
            : `현재 ${shortage.returned}개만 참여할 수 있어요.`}
        </p>
      </div>
      <div className="stackCompact">
        <p>최대 5개는 진행 목표입니다. 없는 카드는 표시하지 않습니다.</p>
        <p>
          다음 확인: <strong>{formatRefreshTime(shortage.nextRefreshAt)}</strong>
        </p>
      </div>
    </section>
  )
}
