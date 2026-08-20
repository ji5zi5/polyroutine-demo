export const GOAL_ANALYSIS_RATE_LIMIT = 5 as const
export const GOAL_ANALYSIS_RATE_WINDOW_MS = 60_000 as const

type WindowState = {
  count: number
  readonly startedAt: number
}

export type RateLimiter = {
  readonly consume: (request: Request) => boolean
}

export function createDomainIpRateLimiter(now: () => number = Date.now): RateLimiter {
  /** Mutable request-window cache; mutation is this object's purpose. */
  const windows = new Map<string, WindowState>()

  return {
    consume: (request) => {
      const forwardedIp =
        request.headers.get("x-nf-client-connection-ip") ??
        request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ??
        "unknown"
      const key = `${new URL(request.url).host}\n${forwardedIp}`
      const timestamp = now()
      const current = windows.get(key)

      if (current === undefined || timestamp - current.startedAt >= GOAL_ANALYSIS_RATE_WINDOW_MS) {
        windows.set(key, { count: 1, startedAt: timestamp })
        return true
      }
      if (current.count >= GOAL_ANALYSIS_RATE_LIMIT) return false

      current.count += 1
      return true
    },
  }
}
