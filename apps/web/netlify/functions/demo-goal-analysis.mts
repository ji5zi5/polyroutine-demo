import type { Config, Context } from "@netlify/functions"
import { createGeminiGoalAnalysisProvider } from "../../lib/demo-goal-analysis/provider"
import {
  createGeminiStructuredJsonTransport,
  createKyGeminiHttpClient,
} from "../../lib/demo-goal-analysis/server/gemini-transport"
import { createGoalAnalysisHandler } from "../../lib/demo-goal-analysis/server/handler"
import {
  createDomainIpRateLimiter,
  GOAL_ANALYSIS_RATE_LIMIT,
  GOAL_ANALYSIS_RATE_WINDOW_MS,
} from "../../lib/demo-goal-analysis/server/rate-limit"

const client = createKyGeminiHttpClient()
const rateLimiter = createDomainIpRateLimiter()

export const handler = createGoalAnalysisHandler({
  analyze: async (request, signal) => {
    const transport = createGeminiStructuredJsonTransport({
      // biome-ignore lint/complexity/useLiteralKeys: strict index-signature access keeps this server-only env read typed.
      apiKey: process.env["GEMINI_API_KEY"],
      client,
      requestSignal: signal,
    })
    return createGeminiGoalAnalysisProvider(transport).analyze(request)
  },
  consumeRateLimit: rateLimiter.consume,
})

// biome-ignore lint/style/noDefaultExport: Netlify Functions requires the entrypoint default export.
export default async (request: Request, _context: Context): Promise<Response> => handler(request)

export const config: Config = {
  path: "/api/demo/goal-analysis",
  rateLimit: {
    aggregateBy: ["ip", "domain"],
    windowLimit: GOAL_ANALYSIS_RATE_LIMIT,
    windowSize: GOAL_ANALYSIS_RATE_WINDOW_MS / 1_000,
  },
}
