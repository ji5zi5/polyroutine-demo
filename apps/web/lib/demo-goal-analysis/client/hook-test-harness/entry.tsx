import { useState } from "react"
import { createRoot } from "react-dom/client"
import { GoalAnalysisPanel } from "../../../../components/demo-goal-analysis/goal-analysis-panel"
import "../../../../app/tokens.css"
import {
  createGoalAnalysisClient,
  type GoalAnalysisClient,
  type GoalAnalysisTransport,
} from "../goal-analysis-client"
import { useGoalAnalysis } from "../use-goal-analysis"

type Deferred = {
  readonly resolve: (value: unknown) => void
  readonly response: { json(): Promise<unknown> }
}

function createDeferred(): Deferred {
  let resolvePromise: ((value: unknown) => void) | undefined
  const promise = new Promise<unknown>((resolve) => {
    resolvePromise = resolve
  })
  if (resolvePromise === undefined) throw new TypeError("Deferred response was not initialized")
  return { resolve: resolvePromise, response: { json: () => promise } }
}

function Probe({ client }: { readonly client: GoalAnalysisClient }) {
  const { analyze, reset, state } = useGoalAnalysis(client)
  return (
    <section data-testid="probe">
      <output data-testid="state">{state.kind}</output>
      <button onClick={() => void analyze(["매일 10분 걷기"])} type="button">
        분석
      </button>
      <button onClick={reset} type="button">
        재설정
      </button>
    </section>
  )
}

function App() {
  const [mounted, setMounted] = useState(true)
  const [signalAborted, setSignalAborted] = useState(false)
  const [pending] = useState<Deferred[]>([])
  const [transport] = useState<GoalAnalysisTransport>(() => ({
    post(_route, options) {
      const deferred = createDeferred()
      pending.push(deferred)
      setSignalAborted(options.signal.aborted)
      options.signal.addEventListener("abort", () => setSignalAborted(true), { once: true })
      return deferred.response
    },
  }))
  const [client] = useState(() => createGoalAnalysisClient(transport))
  const [successClient] = useState(() =>
    createGoalAnalysisClient({
      post: () => ({
        json: async () => ({
          confidence: "high",
          factors: ["구체적인 수치가 있어요"],
          probability: 73,
          source: "gemini",
        }),
      }),
    }),
  )

  return (
    <main>
      <output data-testid="signal">{String(signalAborted)}</output>
      {mounted ? <Probe client={client} /> : null}
      <button onClick={() => setMounted(false)} type="button">
        언마운트
      </button>
      <button
        onClick={() =>
          pending.at(-1)?.resolve({
            confidence: "high",
            factors: ["늦은 응답이에요"],
            probability: 91,
            source: "gemini",
          })
        }
        type="button"
      >
        늦은 응답 완료
      </button>
      <GoalAnalysisPanel client={successClient} goals={["매일 10분 걷기"]} />
    </main>
  )
}

const root = document.getElementById("root")
if (root === null) throw new TypeError("Hook harness root is missing")
createRoot(root).render(<App />)
