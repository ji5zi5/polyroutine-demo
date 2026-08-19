export { registerAccountsRoutes } from "./routes.js"
export { AccountsService } from "./service.js"
export type {
  AccountAuditEvent,
  AccountAuditSink,
  AccountsDependencies,
  ActorContext,
} from "./types.js"

export const accountsModule = { name: "accounts" } as const
