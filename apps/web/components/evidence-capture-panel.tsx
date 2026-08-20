"use client"

import Image from "next/image"
import type { Account, Goal } from "../lib/contracts"
import { EvidencePhotoInput } from "./evidence-photo-input"
import { EvidenceStatusView } from "./evidence-status-view"
import { CheckboxField } from "./form-field"
import { Notice } from "./notice"
import { useEvidenceCapture } from "./use-evidence-capture"

type EvidenceCapturePanelProps = {
  readonly account: Account
  readonly goal: Goal
  readonly online: boolean
}

export function EvidenceCapturePanel({ account, goal, online }: EvidenceCapturePanelProps) {
  const { actions, state } = useEvidenceCapture({ account, goal, online })

  if (state.receiptId !== null) {
    return (
      <EvidenceStatusView
        busy={state.statusBusy}
        evidence={state.evidence}
        onRefresh={() => void actions.refreshStatus()}
        onResubmit={actions.resetForResubmission}
        receiptId={state.receiptId}
      />
    )
  }

  const minutes = Math.floor(state.remainingSeconds / 60)
  const seconds = state.remainingSeconds % 60
  return (
    <section className="surfacePanel capturePanel" aria-labelledby="evidence-capture-heading">
      <div className="stackCompact">
        <p className="eyebrow">study_note_photo_v1 · recipe v1</p>
        <h2 id="evidence-capture-heading">학습 노트 사진을 제출해요</h2>
      </div>
      <ol className="captureGuideList">
        <li>오늘 25분 학습한 뒤 오늘 날짜를 적어요.</li>
        <li>서버가 주는 10분 코드와 학습 노트 {goal.fields.noteLineTarget}줄 이상을 적어요.</li>
        <li>날짜, 코드, 노트를 한 프레임에 선명하게 담아요.</li>
      </ol>
      <p className="formHelper">
        코드는 재사용을 줄이는 신호일 뿐 실제 완료, 진위, 실시간 촬영을 증명하지 않아요.
      </p>
      <CheckboxField
        helper="사진은 제한된 운영 검토 후 정책 기한에 따라 삭제해요."
        id={`evidence-consent-${goal.id}`}
        input={{
          checked: state.consent,
          disabled: state.uploading,
          onChange: (event) => actions.setConsent(event.currentTarget.checked),
        }}
        label="사진 제출과 운영자 검토에 동의해요"
      />
      {state.message === null ? null : (
        <Notice announce kind={state.message.kind}>
          {state.message.text}
        </Notice>
      )}
      {!state.submissionOpen ? (
        <Notice kind="info">
          예측 마감 뒤 서버가 증거 제출을 열면 10분 코드를 받을 수 있어요.
        </Notice>
      ) : null}
      {state.submissionOpen && (state.challenge === null || state.challengeExpired) ? (
        <button
          className="buttonFull"
          disabled={!state.consent || !state.online || state.preparing}
          onClick={() => void actions.beginChallenge()}
          type="button"
        >
          {state.preparing
            ? "코드 준비 중"
            : state.challengeExpired
              ? "새 10분 코드 받기"
              : "10분 코드 받기"}
        </button>
      ) : state.challenge !== null ? (
        <div className="captureChallenge" aria-live="polite">
          <p className="formLabel">사진에 그대로 적을 서버 코드</p>
          <strong data-testid="evidence-challenge-code">{state.challenge.code}</strong>
          <p data-testid="evidence-challenge-timer">
            {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")} 남음 · 서버 만료{" "}
            {state.challenge.expiresAt}
          </p>
        </div>
      ) : null}
      <EvidencePhotoInput
        disabled={!state.activeChallenge || state.uploading || state.transportRetry}
        onCameraMessage={actions.setCameraMessage}
        onPhoto={actions.selectPhoto}
      />
      {state.photo === null ? null : (
        <figure className="capturePreview">
          <Image
            alt="선택한 학습 노트 사진 미리보기"
            height={3}
            src={state.photo.previewUrl}
            unoptimized
            width={4}
          />
          <figcaption>미리보기는 이 기기에만 남고 접수하거나 취소하면 지워져요.</figcaption>
        </figure>
      )}
      {state.uploading && state.uploadProgress !== null ? (
        <div className="captureProgress">
          <progress
            aria-label="사진 바이트 전송률"
            max={state.uploadProgress.total}
            value={state.uploadProgress.loaded}
          />
          <p>
            측정된 전송{" "}
            {Math.round((state.uploadProgress.loaded / state.uploadProgress.total) * 100)}%
          </p>
        </div>
      ) : null}
      <div className="captureActions">
        <button
          disabled={
            !state.activeChallenge || state.photo === null || state.uploading || !state.online
          }
          onClick={() => void actions.submitPhoto()}
          type="button"
        >
          {state.uploading
            ? "사진 바이트 전송 중"
            : state.transportRetry
              ? "접수 여부 다시 확인하기"
              : "사진 제출하기"}
        </button>
        {state.uploading ? (
          <button className="buttonQuiet" onClick={actions.abortUpload} type="button">
            업로드 취소하기
          </button>
        ) : null}
        <a className="quietLink" href="/v1/safety/policy" rel="noreferrer" target="_blank">
          금지 이미지·신고·보존 정책
        </a>
      </div>
    </section>
  )
}
