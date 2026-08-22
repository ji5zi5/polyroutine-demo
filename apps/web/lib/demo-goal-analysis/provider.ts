import {
  type GoalAnalysisError,
  type GoalAnalysisOutcome,
  GoalAnalysisPayloadSchema,
  type GoalAnalysisRequest,
  GoalAnalysisResultSchema,
} from "./contract"

export const GEMINI_ANALYSIS_MODEL = "gemini-3.5-flash-lite" as const

export const GEMINI_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["probability", "confidence", "factors"],
  properties: {
    probability: { type: "integer", minimum: 0, maximum: 100 },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    factors: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string", minLength: 1, maxLength: 60 },
    },
  },
} as const

export type GeminiTransportRequest = {
  readonly model: typeof GEMINI_ANALYSIS_MODEL
  readonly responseMimeType: "application/json"
  readonly responseJsonSchema: typeof GEMINI_RESULT_JSON_SCHEMA
  readonly goals: readonly string[]
}

export type GeminiTransportOutcome =
  | { readonly ok: true; readonly json: string }
  | { readonly ok: false; readonly error: GoalAnalysisError }

export interface GeminiStructuredJsonTransport {
  generate(request: GeminiTransportRequest): Promise<GeminiTransportOutcome>
}

export interface GoalAnalysisProvider {
  analyze(request: GoalAnalysisRequest): Promise<GoalAnalysisOutcome>
}

function parseGeminiResult(json: string): GoalAnalysisOutcome {
  let input: unknown
  try {
    input = JSON.parse(json)
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, error: { code: "invalid_schema" } }
    throw error
  }

  const payload = GoalAnalysisPayloadSchema.safeParse(input)
  if (!payload.success) return { ok: false, error: { code: "invalid_schema" } }

  return {
    ok: true,
    value: GoalAnalysisResultSchema.parse({ ...payload.data, source: "gemini" }),
  }
}

export function createGeminiGoalAnalysisProvider(
  transport: GeminiStructuredJsonTransport,
): GoalAnalysisProvider {
  return {
    analyze: async (request) => {
      const transportOutcome = await transport.generate({
        model: GEMINI_ANALYSIS_MODEL,
        responseMimeType: "application/json",
        responseJsonSchema: GEMINI_RESULT_JSON_SCHEMA,
        goals: request.goals,
      })

      switch (transportOutcome.ok) {
        case false:
          return { ok: false, error: transportOutcome.error }
        case true:
          return parseGeminiResult(transportOutcome.json)
      }
    },
  }
}
