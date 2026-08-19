import { accountsModule } from "./accounts/index.js"
import { analyticsModule } from "./analytics/index.js"
import { evidenceModule } from "./evidence/index.js"
import { goalsModule } from "./goals/index.js"
import { moderationModule } from "./moderation/index.js"
import { predictionsModule } from "./predictions/index.js"
import { settlementModule } from "./settlement/index.js"

export const serverModules = [
  accountsModule,
  goalsModule,
  predictionsModule,
  evidenceModule,
  moderationModule,
  settlementModule,
  analyticsModule,
] as const

export type ServerModuleName = (typeof serverModules)[number]["name"]
