import Link from "next/link"
import { StatusPanel } from "../components/status-panel"

export default function HomePage() {
  return (
    <main id="main-content" className="pageShell">
      <header className="hero stack">
        <p className="productName">폴리루틴</p>
        <h1>오늘 할 한 가지를 분명하게</h1>
        <p className="lead">
          한 번에 하나의 학습 약속을 기록하고, 예측과 증거로 끝까지 확인합니다.
        </p>
      </header>
      <StatusPanel
        action={
          <Link className="actionLink" href="/manifest.webmanifest">
            앱 정보 보기
          </Link>
        }
        heading="선택된 PWA 기반이 준비되었습니다"
        state={{ kind: "ready", label: "준비 완료" }}
      >
        <p>계정, 목표, 예측, 증거, 운영 검토, 정산, 분석이 하나의 서버 배포 단위에 있습니다.</p>
      </StatusPanel>
    </main>
  )
}
