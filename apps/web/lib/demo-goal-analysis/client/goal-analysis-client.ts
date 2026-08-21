import ky, { HTTPError, TimeoutError } from "ky"
import {
  type GoalAnalysisError,
  GoalAnalysisErrorSchema,
  type GoalAnalysisRequest,
  type GoalAnalysisResult,
  GoalAnalysisResultSchema,
} from "../contract"
import { analyzeGoalsFallback } from "../fallback"

export const GOAL_ANALYSIS_ROUTE = "/api/demo/goal-analysis" as const
export const GOAL_ANALYSIS_TIMEOUT_MS = 10_000 as const

export type GoalAnalysisTransportOptions = {
  readonly json: GoalAnalysisRequest
  readonly retry: 0
  readonly signal: AbortSignal
  readonly timeout: typeof GOAL_ANALYSIS_TIMEOUT_MS
}

export interface GoalAnalysisTransport {
  post(
    route: typeof GOAL_ANALYSIS_ROUTE,
    options: GoalAnalysisTransportOptions,
  ): { json(): Promise<unknown> }
}

type GoalAnalysisFailureCode = GoalAnalysisError["code"]
export type GoalAnalysisFallbackReason = GoalAnalysisFailureCode | "network"

export type GoalAnalysisClientResult =
  | {
      readonly kind: "completed"
      readonly label: "Gemini 분석"
      readonly value: GoalAnalysisResult
    }
  | {
      readonly kind: "fallback"
      readonly label: "데모 계산"
      readonly reason: GoalAnalysisFallbackReason
      readonly value: GoalAnalysisResult
    }
  | { readonly kind: "cancelled" }

export interface GoalAnalysisClient {
  analyze(request: GoalAnalysisRequest): Promise<GoalAnalysisClientResult>
  cancel(): void
}

const defaultTransport: GoalAnalysisTransport = {
  post: (route, options) => ky.post(route, options),
}

function fallbackResult(
  request: GoalAnalysisRequest,
  reason: GoalAnalysisFallbackReason,
): GoalAnalysisClientResult {
  return { kind: "fallback", label: "데모 계산", reason, value: analyzeGoalsFallback(request) }
}

async function reasonForHttpError(error: HTTPError): Promise<GoalAnalysisFallbackReason> {
  try {
    const parsed = GoalAnalysisErrorSchema.safeParse(await error.response.clone().json())
    if (parsed.success) return parsed.data.code
  } catch (parseError) {
    if (!(parseError instanceof Error)) throw parseError
  }
  if (error.response.status === 429) return "rate_limited"
  return "provider_unavailable"
}

export function createGoalAnalysisClient(
  transport: GoalAnalysisTransport = defaultTransport,
): GoalAnalysisClient {
  let active: { readonly controller: AbortController; readonly id: number } | undefined
  let nextId = 0

  const cancel = (): void => {
    nextId += 1
    active?.controller.abort()
    active = undefined
  }

  return {
    async analyze(request) {
      cancel()
      const id = nextId
      const controller = new AbortController()
      active = { controller, id }

      try {
        const input = await transport
          .post(GOAL_ANALYSIS_ROUTE, {
            json: request,
            retry: 0,
            signal: controller.signal,
            timeout: GOAL_ANALYSIS_TIMEOUT_MS,
          })
          .json()
        if (active?.id !== id) return { kind: "cancelled" }

        const parsedResult = GoalAnalysisResultSchema.safeParse(input)
        if (parsedResult.success && parsedResult.data.source === "gemini") {
          return { kind: "completed", label: "Gemini 분석", value: parsedResult.data }
        }

        const parsedError = GoalAnalysisErrorSchema.safeParse(input)
        return fallbackResult(
          request,
          parsedError.success ? parsedError.data.code : "invalid_schema",
        )
      } catch (error) {
        if (active?.id !== id || controller.signal.aborted) return { kind: "cancelled" }
        if (error instanceof TimeoutError) return fallbackResult(request, "timeout")
        if (error instanceof HTTPError) {
          return fallbackResult(request, await reasonForHttpError(error))
        }
        if (error instanceof SyntaxError) return fallbackResult(request, "invalid_schema")
        if (error instanceof Error) return fallbackResult(request, "network")
        throw error
      } finally {
        if (active?.id === id) active = undefined
      }
    },
    cancel,
  }
}
