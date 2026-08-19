import Link from "next/link"
import { StatusPanel } from "../../components/status-panel"

export default function ShowcasePage() {
  return (
    <main className="pageShell">
      <header className="stack">
        <p className="productName">컴포넌트 쇼케이스</p>
        <h1>상태 패널</h1>
        <p className="lead">색만으로 구분하지 않고 각 상태와 다음 행동을 글로 설명합니다.</p>
      </header>
      <div className="showcaseGrid">
        <StatusPanel
          action={
            <Link className="actionLink" href="/">
              홈으로
            </Link>
          }
          heading="서비스를 사용할 수 있습니다"
          state={{ kind: "ready", label: "준비 완료" }}
        >
          <p>필수 연결이 모두 준비되었습니다.</p>
        </StatusPanel>
        <StatusPanel
          action={
            <button disabled type="button">
              확인 중
            </button>
          }
          heading="데이터 연결을 확인하고 있습니다"
          state={{ kind: "pending", label: "확인 중" }}
        >
          <p>확인이 끝나면 같은 위치에서 다음 행동을 안내합니다.</p>
        </StatusPanel>
        <StatusPanel
          action={
            <Link className="quietLink" href="/">
              다시 확인
            </Link>
          }
          heading="지금은 준비 상태를 확인할 수 없습니다"
          state={{ kind: "error", label: "연결 오류" }}
        >
          <p>잠시 뒤 다시 확인하거나 홈으로 돌아가세요.</p>
        </StatusPanel>
      </div>
    </main>
  )
}
