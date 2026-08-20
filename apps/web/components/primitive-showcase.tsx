"use client"

import Link from "next/link"
import { FormField } from "./form-field"
import { Notice } from "./notice"
import { PredictionCard, type PredictionCardModel } from "./prediction-card"
import { ShortagePanel } from "./shortage-panel"
import { StatusPanel } from "./status-panel"
import { TodayTimeline } from "./today-timeline"

const showcaseCard: PredictionCardModel = {
  anonymousAlias: "Participant-7A21C4E0",
  evidenceDeadlineAt: "2026-08-20T09:30:00.000Z",
  goalId: "190fc32f-e3f8-4f8d-9134-13bca6ce5dd8",
  predictionCutoffAt: "2026-08-19T21:30:00.000Z",
  recipe: {
    id: "study_note_photo_v1",
    instructions: "Guided study note photo",
    version: 1,
  },
}

export function PrimitiveShowcase() {
  return (
    <main className="pageShell">
      <header className="stack">
        <p className="productName">컴포넌트 쇼케이스</p>
        <h1>상태와 행동의 언어</h1>
        <p className="lead">서버 확인 전후, 부족함, 오류를 같은 디자인 문법으로 설명합니다.</p>
      </header>

      <section className="showcaseSection" aria-labelledby="showcase-status">
        <h2 id="showcase-status">상태 패널과 알림</h2>
        <div className="showcaseColumns">
          <StatusPanel
            action={
              <Link className="actionLink" href="/">
                홈으로
              </Link>
            }
            heading="서비스가 준비되었습니다"
            state={{ kind: "ready", label: "준비 완료" }}
          >
            <p>필수 연결이 준비됐습니다.</p>
          </StatusPanel>
          <StatusPanel
            action={
              <button disabled type="button">
                서버 확인 중
              </button>
            }
            heading="서버에서 확인 중입니다"
            state={{ kind: "pending", label: "확인 중" }}
          >
            <p>서버 응답 전에는 완료가 아닙니다.</p>
          </StatusPanel>
          <StatusPanel
            action={
              <Link className="quietLink" href="/">
                다시 확인
              </Link>
            }
            heading="지금은 연결할 수 없어요"
            state={{ kind: "error", label: "연결 오류" }}
          >
            <p>같은 요청을 다시 확인하세요.</p>
          </StatusPanel>
        </div>
        <div className="showcaseColumns">
          <Notice kind="info">서버가 보낸 마감 시간을 표시합니다.</Notice>
          <Notice kind="success">YES가 서버에 저장되었습니다.</Notice>
          <Notice kind="error">연결이 끊겼습니다. 서버 확인이 필요합니다.</Notice>
        </div>
      </section>

      <section className="showcaseSection" aria-labelledby="showcase-controls">
        <h2 id="showcase-controls">입력과 행동</h2>
        <div className="showcaseColumns">
          <div className="surfacePanel">
            <FormField
              helper="최소 3줄, 최대 20줄"
              id="showcase-lines"
              input={{ defaultValue: 3, max: 20, min: 3, type: "number" }}
              label="학습 노트 줄 수"
            />
            <div className="buttonCluster">
              <button type="button">저장하기</button>
              <button className="buttonQuiet" type="button">
                취소
              </button>
            </div>
          </div>
          <div className="surfacePanel">
            <FormField
              error="이메일 형식을 확인해 주세요."
              id="showcase-email"
              input={{ defaultValue: "adult", type: "email" }}
              label="이메일"
            />
            <button aria-busy="true" disabled type="button">
              서버 확인 중
            </button>
          </div>
        </div>
      </section>

      <section className="showcaseSection" aria-labelledby="showcase-timeline">
        <h2 id="showcase-timeline">오늘의 흐름</h2>
        <div className="surfacePanel">
          <TodayTimeline goalState="prediction_open" priorResultAvailable={false} />
        </div>
      </section>

      <section className="showcaseSection" aria-labelledby="showcase-prediction">
        <h2 id="showcase-prediction">예측 카드</h2>
        <PredictionCard busy={false} card={showcaseCard} onChoice={() => undefined} />
      </section>

      <section className="showcaseSection" aria-labelledby="showcase-shortage">
        <h2 id="showcase-shortage">부족한 카드</h2>
        <div className="showcaseColumns">
          <ShortagePanel
            shortage={{
              nextRefreshAt: "2026-08-19T21:05:00.000Z",
              reason: "eligible_pool_exhausted",
              requested: 5,
              returned: 0,
            }}
          />
          <ShortagePanel
            shortage={{
              nextRefreshAt: "2026-08-19T21:05:00.000Z",
              reason: "eligible_pool_exhausted",
              requested: 5,
              returned: 3,
            }}
          />
        </div>
      </section>
    </main>
  )
}
