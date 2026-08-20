export const analyticsModule = { name: "analytics" } as const

export type {
  AnalyticsCohortContext,
  AnalyticsEventSink,
  PublishAnalyticsResult,
} from "./outbox.js"
export {
  analyticsCohortContext,
  appendAnalyticsEvent,
  publishPendingAnalyticsEvent,
} from "./outbox.js"
