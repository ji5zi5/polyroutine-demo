import type { EvidenceStatus } from "../lib/contracts"
import { StatusPanel } from "./status-panel"

const reasonCopy = {
  challenge_not_visible: "현재 서버 코드가 사진에서 확인되지 않았습니다.",
  image_unreadable: "흐림·빛 반사·잘림 때문에 안내 항목을 확인하기 어려웠습니다.",
  notes_insufficient: "당일 학습 노트가 요구한 줄 수만큼 확인되지 않았습니다.",
  recipe_mismatch: "사진이 안내된 한 프레임 구성을 충족하지 않았습니다.",
  review_unavailable: "운영 검토를 완료하지 못했습니다. 사진 내용이 실패로 판정된 것은 아닙니다.",
} satisfies Record<NonNullable<EvidenceStatus["reasonCode"]>, string>

type EvidenceStatusViewProps = {
  readonly busy: boolean
  readonly evidence: EvidenceStatus | null
  readonly onRefresh: () => void
  readonly onResubmit: () => void
  readonly receiptId: string
}

function PolicyLink() {
  return (
    <a className="quietLink" href="/v1/safety/policy" rel="noreferrer" target="_blank">
      금지 이미지·신고·보존 정책
    </a>
  )
}

export function EvidenceStatusView({
  busy,
  evidence,
  onRefresh,
  onResubmit,
  receiptId,
}: EvidenceStatusViewProps) {
  if (evidence === null || evidence.state === "pending") {
    return (
      <StatusPanel
        action={
          <div className="captureActions">
            <button className="buttonQuiet" disabled={busy} onClick={onRefresh} type="button">
              {busy ? "상태 확인 중" : "검토 상태 새로고침"}
            </button>
            <PolicyLink />
          </div>
        }
        heading="사진 영수증이 접수되었습니다"
        state={{ kind: "pending", label: "운영 검토 대기" }}
      >
        <p>서버 영수증 {receiptId}을 받았습니다.</p>
        <p>검토가 끝날 때까지 pending이며 완료 시간은 약속하지 않습니다.</p>
      </StatusPanel>
    )
  }

  if (evidence.state === "accepted") {
    return (
      <StatusPanel
        action={<PolicyLink />}
        heading="안내된 사진 항목이 확인되었습니다"
        state={{ kind: "ready", label: "검토 결과 · 확인" }}
      >
        <p>
          운영 검토는 사진 속 레시피 항목만 확인합니다. 실제 학습 완료, 사진 진위, 실시간 촬영을
          증명하지 않습니다.
        </p>
      </StatusPanel>
    )
  }

  const fallback =
    evidence.state === "rejected"
      ? "안내된 사진 항목을 확인하지 못했습니다."
      : "사진만으로 안내 항목을 확인하기 어려웠습니다."
  const copy = evidence.reasonCode === null ? fallback : reasonCopy[evidence.reasonCode]
  return (
    <StatusPanel
      action={
        <div className="captureActions">
          {evidence.canResubmit ? (
            <button onClick={onResubmit} type="button">
              새 코드로 다시 제출
            </button>
          ) : null}
          <PolicyLink />
        </div>
      }
      heading={
        evidence.state === "rejected"
          ? "안내 항목이 확인되지 않았습니다"
          : "사진만으로 확인하기 어려웠습니다"
      }
      state={{
        kind: evidence.state === "rejected" ? "error" : "pending",
        label: evidence.state === "rejected" ? "검토 결과 · 불충족" : "검토 결과 · 판정 불가",
      }}
    >
      <p>{copy}</p>
      {evidence.attemptsRemaining === 0 ? (
        <p>두 번의 제출 기회를 모두 사용했습니다. 같은 사진을 다시 보내지 않습니다.</p>
      ) : (
        <p>서버 마감 전에 한 번 더 새 코드와 새 사진으로 제출할 수 있습니다.</p>
      )}
    </StatusPanel>
  )
}
