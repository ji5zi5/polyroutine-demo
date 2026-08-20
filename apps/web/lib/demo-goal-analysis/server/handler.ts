import {
  type GoalAnalysisError,
  type GoalAnalysisOutcome,
  type GoalAnalysisRequest,
  GoalAnalysisRequestSchema,
} from "../contract"

export const GOAL_ANALYSIS_BODY_LIMIT_BYTES = 4_096 as const

export type GoalAnalyzer = (
  request: GoalAnalysisRequest,
  signal: AbortSignal,
) => Promise<GoalAnalysisOutcome>

export type GoalAnalysisHandlerDependencies = {
  readonly analyze: GoalAnalyzer
  readonly consumeRateLimit: (request: Request) => boolean
}

type FailureCode = GoalAnalysisError["code"]

const FAILURE_STATUS = {
  invalid_input: 400,
  invalid_schema: 502,
  missing_key: 503,
  provider_unavailable: 503,
  rate_limited: 429,
  timeout: 504,
} as const satisfies Record<FailureCode, number>

function jsonResponse(body: object, status: number, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  })
}

async function readLimitedBody(request: Request): Promise<string | undefined> {
  const declaredLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > GOAL_ANALYSIS_BODY_LIMIT_BYTES) {
    return undefined
  }

  const body = await request.text()
  return new TextEncoder().encode(body).byteLength <= GOAL_ANALYSIS_BODY_LIMIT_BYTES
    ? body
    : undefined
}

export function createGoalAnalysisHandler(
  dependencies: GoalAnalysisHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") {
      return jsonResponse({ code: "invalid_input" }, 405, { allow: "POST" })
    }

    if (
      request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json"
    ) {
      return jsonResponse({ code: "invalid_input" }, 415)
    }

    const body = await readLimitedBody(request)
    if (body === undefined) return jsonResponse({ code: "invalid_input" }, 413)

    let input: unknown
    try {
      input = JSON.parse(body)
    } catch (error) {
      if (error instanceof SyntaxError) return jsonResponse({ code: "invalid_input" }, 400)
      throw error
    }

    const parsed = GoalAnalysisRequestSchema.safeParse(input)
    if (!parsed.success) return jsonResponse({ code: "invalid_input" }, 400)
    if (!dependencies.consumeRateLimit(request)) {
      return jsonResponse({ code: "rate_limited" }, 429)
    }

    let outcome: GoalAnalysisOutcome
    try {
      outcome = await dependencies.analyze(parsed.data, request.signal)
    } catch (error) {
      if (error instanceof Error) {
        return jsonResponse({ code: "provider_unavailable" }, 503)
      }
      throw error
    }
    switch (outcome.ok) {
      case true:
        return jsonResponse(outcome.value, 200)
      case false:
        return jsonResponse(outcome.error, FAILURE_STATUS[outcome.error.code])
    }
  }
}
