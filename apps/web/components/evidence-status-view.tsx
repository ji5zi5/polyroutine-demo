import type { EvidenceStatus } from "../lib/contracts"
import { StatusPanel } from "./status-panel"

const reasonCopy = {
  challenge_not_visible: "현재 서버 코드를 사진에서 확인하지 못했어요.",
  image_unreadable: "흐림·빛 반사·잘림 때문에 안내 항목을 확인하기 어려웠어요.",
  notes_insufficient: "당일 학습 노트를 필요한 줄 수만큼 확인하지 못했어요.",
  recipe_mismatch: "사진에서 안내한 한 프레임 구성을 확인하지 못했어요.",
  review_unavailable: "운영 검토를 마치지 못했어요. 사진 내용이 실패로 판정된 것은 아니에요.",
} satisfies Record<NonNullable<EvidenceStatus["reasonCode"]>, string>

type EvidenceStatusViewProps = {
  readonly busy: boolean
  readonly evidence: EvidenceStatus | null
  readonly onRefresh: () => void
  readonly onResubmit: () => void
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
}: EvidenceStatusViewProps) {
  if (evidence === null || evidence.state === "pending") {
    return (
      <StatusPanel
        action={
          <div className="captureActions">
            <button disabled={busy} onClick={onRefresh} type="button">
              {busy ? "상태 확인 중" : "검토 상태 확인하기"}
            </button>
            <PolicyLink />
          </div>
        }
        className="evidenceStatusPanel"
        heading="사진을 확인하고 있어요"
        state={{ kind: "pending", label: "인증 확인 중" }}
      >
        <p>사진을 안전하게 접수했어요. 확인이 끝나면 여기에서 결과를 볼 수 있어요.</p>
      </StatusPanel>
    )
  }

  if (evidence.state === "accepted") {
    return (
      <StatusPanel
        action={null}
        className="evidenceStatusPanel"
        heading="사진 인증이 끝났어요"
        state={{ kind: "ready", label: "인증 완료" }}
      >
        <p>오늘 날짜와 학습 노트를 사진에서 확인했어요.</p>
      </StatusPanel>
    )
  }

  const fallback =
    evidence.state === "rejected"
      ? "안내한 사진 항목을 확인하지 못했어요."
      : "사진만으로 안내 항목을 확인하기 어려워요."
  const copy = evidence.reasonCode === null ? fallback : reasonCopy[evidence.reasonCode]
  return (
    <StatusPanel
      action={
        <div className="captureActions">
          {evidence.canResubmit ? (
            <button onClick={onResubmit} type="button">
              새 코드로 다시 제출하기
            </button>
          ) : null}
          <PolicyLink />
        </div>
      }
      className="evidenceStatusPanel"
      heading={
        evidence.state === "rejected"
          ? "안내 항목을 확인하지 못했어요"
          : "사진만으로 확인하기 어려워요"
      }
      state={{
        kind: evidence.state === "rejected" ? "error" : "pending",
        label: evidence.state === "rejected" ? "검토 결과 · 불충족" : "검토 결과 · 판정 불가",
      }}
    >
      <p>{copy}</p>
      {evidence.attemptsRemaining === 0 ? (
        <p>두 번의 제출 기회를 모두 사용했어요. 같은 사진은 다시 보내지 않아요.</p>
      ) : (
        <p>서버 마감 전에 새 코드와 새 사진으로 한 번 더 제출할 수 있어요.</p>
      )}
    </StatusPanel>
  )
}
