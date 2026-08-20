import { z } from "zod"

const GoalSchema = z.string().trim().min(1).max(120)

export const GoalAnalysisRequestSchema = z
  .object({
    goals: z.array(GoalSchema).min(1).max(5).readonly(),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.goals).size !== request.goals.length) {
      context.addIssue({ code: "custom", message: "goals must be unique", path: ["goals"] })
    }

    if (request.goals.reduce((total, goal) => total + goal.length, 0) > 600) {
      context.addIssue({
        code: "custom",
        message: "goals must total at most 600 characters",
        path: ["goals"],
      })
    }
  })
  .readonly()

export type GoalAnalysisRequest = z.infer<typeof GoalAnalysisRequestSchema>

export const GoalAnalysisPayloadSchema = z
  .object({
    probability: z.number().int().min(0).max(100),
    confidence: z.enum(["low", "medium", "high"]),
    factors: z.array(z.string().min(1).max(60)).min(1).max(3).readonly(),
  })
  .strict()
  .readonly()

export const GoalAnalysisResultSchema = z
  .object({
    probability: z.number().int().min(0).max(100),
    confidence: z.enum(["low", "medium", "high"]),
    factors: z.array(z.string().min(1).max(60)).min(1).max(3).readonly(),
    source: z.enum(["gemini", "fallback"]),
  })
  .strict()
  .readonly()

export type GoalAnalysisResult = z.infer<typeof GoalAnalysisResultSchema>

export const GoalAnalysisFailureCodeSchema = z.enum([
  "missing_key",
  "rate_limited",
  "timeout",
  "invalid_input",
  "invalid_schema",
  "provider_unavailable",
])

export const GoalAnalysisErrorSchema = z
  .object({
    code: GoalAnalysisFailureCodeSchema,
  })
  .strict()
  .readonly()

export type GoalAnalysisError = z.infer<typeof GoalAnalysisErrorSchema>

export type GoalAnalysisOutcome =
  | { readonly ok: true; readonly value: GoalAnalysisResult }
  | { readonly ok: false; readonly error: GoalAnalysisError }
