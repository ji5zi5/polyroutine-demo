import type { DatabaseHandle } from "@polyroutine/db"
import { analyticsCohortContext, appendAnalyticsEvent } from "../analytics/index.js"
import type { PredictionChoice } from "./contract.js"

type DatabaseClient = Pick<DatabaseHandle["pool"], "query">

type PredictionAnalyticsEvent =
  | {
      readonly actorSubjectKey: string
      readonly businessKey: string
      readonly goalId: string
      readonly kind: "listed"
      readonly occurredAt: Date
    }
  | {
      readonly actorSubjectKey: string
      readonly businessKey: string
      readonly goalId: string
      readonly kind: "exposed"
      readonly occurredAt: Date
    }
  | {
      readonly actorSubjectKey: string
      readonly businessKey: string
      readonly choice: PredictionChoice
      readonly goalId: string
      readonly kind: "submitted"
      readonly occurredAt: Date
    }
  | {
      readonly actorSubjectKey: string
      readonly businessKey: string
      readonly kind: "shortage"
      readonly occurredAt: Date
      readonly returnedCount: number
    }

function assertNever(value: never): never {
  throw new TypeError(`unexpected prediction analytics event: ${String(value)}`)
}

export async function recordPredictionAnalytics(
  client: DatabaseClient,
  input: PredictionAnalyticsEvent,
): Promise<void> {
  const cohort = await analyticsCohortContext(client, input.actorSubjectKey, input.occurredAt)
  switch (input.kind) {
    case "listed":
      await appendAnalyticsEvent(client, {
        businessKey: input.businessKey,
        event: {
          ...cohort,
          eventName: "goal_listed",
          eventVersion: 1,
          goalId: input.goalId,
          recipeId: "study_note_photo_v1",
          recipeVersion: 1,
        },
        occurredAt: input.occurredAt,
      })
      return
    case "exposed":
      await appendAnalyticsEvent(client, {
        businessKey: input.businessKey,
        event: {
          ...cohort,
          eventName: "prediction_exposed",
          eventVersion: 1,
          goalId: input.goalId,
          recipeId: "study_note_photo_v1",
          recipeVersion: 1,
        },
        occurredAt: input.occurredAt,
      })
      return
    case "submitted":
      await appendAnalyticsEvent(client, {
        businessKey: input.businessKey,
        event: {
          ...cohort,
          choice: input.choice,
          eventName: "prediction_submitted",
          eventVersion: 1,
          goalId: input.goalId,
          recipeId: "study_note_photo_v1",
          recipeVersion: 1,
        },
        occurredAt: input.occurredAt,
      })
      return
    case "shortage":
      await appendAnalyticsEvent(client, {
        businessKey: input.businessKey,
        event: {
          ...cohort,
          eventName: "prediction_shortage_shown",
          eventVersion: 1,
          reasonCode: "eligible_pool_exhausted",
          requestedCount: 5,
          returnedCount: input.returnedCount,
        },
        occurredAt: input.occurredAt,
      })
      return
    default:
      return assertNever(input)
  }
}
