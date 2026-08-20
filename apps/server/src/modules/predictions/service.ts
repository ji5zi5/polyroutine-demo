import type { Clock, UuidFactory } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import { recordPredictionAnalytics } from "./analytics.js"
import {
  type FeedCard,
  type PredictionChoice,
  type PredictionFeed,
  PredictionServiceError,
  type PredictionView,
} from "./contract.js"
import {
  findPredictionByBusinessKey,
  predictionReplayOrConflict,
  predictionServiceError,
  toPredictionView,
} from "./records.js"

const FEED_SIZE = 5
const REFRESH_INTERVAL_MILLISECONDS = 5 * 60 * 1_000
const RECIPE_INSTRUCTIONS =
  "Study for 25 minutes, then photograph today's date, the server challenge code, and at least 3 lines of study notes in one frame."

type PredictionServiceOptions = {
  readonly clock: Clock
  readonly database: DatabaseHandle
  readonly uuid: UuidFactory
}

type FeedRow = {
  readonly alias: string
  readonly evidence_deadline_at: Date
  readonly id: string
  readonly prediction_cutoff_at: Date
}

type ExposureRow = {
  readonly exposed_at: Date
  readonly goal_id: string
  readonly id: string
  readonly viewer_subject_key: string
}

function feedSeed(now: Date, subjectKey: string): string {
  return `${subjectKey}:${now.toISOString().slice(0, 10)}`
}

function predictionBusinessKey(subjectKey: string, idempotencyKey: string): string {
  return `prediction:${subjectKey}:${idempotencyKey}`
}

function exposureBusinessKey(subjectKey: string, idempotencyKey: string): string {
  return `exposure:${subjectKey}:${idempotencyKey}`
}

export function createPredictionService(options: PredictionServiceOptions) {
  return {
    expose: async (subjectKey: string, goalId: string, idempotencyKey: string) => {
      const businessKey = exposureBusinessKey(subjectKey, idempotencyKey)
      const now = options.clock.now()
      const client = await options.database.pool.connect()
      await client.query("begin")
      try {
        const result = await client.query<ExposureRow>(
          `insert into feed_exposures(id, goal_id, viewer_subject_key, business_key)
           select $1, g.id, $2, $3
           from goals g
           where g.id = $4 and g.owner_subject_key <> $2 and g.state = 'prediction_open'
             and g.prediction_cutoff_at > clock_timestamp()
             and not exists (
               select 1 from predictions p
               where p.goal_id = g.id and p.predictor_subject_key = $2
             )
           on conflict (business_key) do nothing
           returning id::text, goal_id::text, viewer_subject_key, exposed_at`,
          [options.uuid.create(), subjectKey, businessKey, goalId],
        )
        const created = result.rows[0]
        if (created !== undefined) {
          await recordPredictionAnalytics(client, {
            actorSubjectKey: subjectKey,
            businessKey: `prediction-exposed:${created.id}`,
            goalId,
            kind: "exposed",
            occurredAt: now,
          })
          await client.query("commit")
          return { created: true as const, exposure: created }
        }
        const existing = await client.query<ExposureRow>(
          `select id::text, goal_id::text, viewer_subject_key, exposed_at
           from feed_exposures where business_key = $1`,
          [businessKey],
        )
        const replay = existing.rows[0]
        if (
          replay !== undefined &&
          replay.goal_id === goalId &&
          replay.viewer_subject_key === subjectKey
        ) {
          await client.query("commit")
          return { created: false as const, exposure: replay }
        }
        throw new PredictionServiceError("EXPOSURE_CONFLICT", 409, true)
      } catch (error) {
        await client.query("rollback")
        throw error
      } finally {
        client.release()
      }
    },

    feed: async (subjectKey: string): Promise<PredictionFeed> => {
      const now = options.clock.now()
      const result = await options.database.pool.query<FeedRow>(
        `select g.id::text,
           'Participant-' || upper(substr(md5(g.id::text), 1, 8)) as alias,
           g.prediction_cutoff_at, g.evidence_deadline_at
         from goals g
         left join predictions aggregate_prediction on aggregate_prediction.goal_id = g.id
         where g.owner_subject_key <> $1 and g.state = 'prediction_open'
           and g.prediction_cutoff_at > clock_timestamp()
           and not exists (
             select 1 from predictions viewer_prediction
             where viewer_prediction.goal_id = g.id
               and viewer_prediction.predictor_subject_key = $1
           )
         group by g.id
         order by count(aggregate_prediction.id) asc, md5($2 || ':' || g.id::text) asc
         limit $3`,
        [subjectKey, feedSeed(now, subjectKey), FEED_SIZE],
      )
      const cards: FeedCard[] = result.rows.map((row) => ({
        anonymousAlias: row.alias,
        evidenceDeadlineAt: row.evidence_deadline_at.toISOString(),
        goalId: row.id,
        predictionCutoffAt: row.prediction_cutoff_at.toISOString(),
        recipe: {
          id: "study_note_photo_v1",
          instructions: RECIPE_INSTRUCTIONS,
          version: 1,
        },
      }))
      for (const card of cards) {
        await recordPredictionAnalytics(options.database.pool, {
          actorSubjectKey: subjectKey,
          businessKey: `goal-listed:${subjectKey}:${card.goalId}:${options.uuid.create()}`,
          goalId: card.goalId,
          kind: "listed",
          occurredAt: now,
        })
      }
      if (cards.length === FEED_SIZE) return { cards, shortage: null }

      const nextRefreshAt = new Date(now.getTime() + REFRESH_INTERVAL_MILLISECONDS).toISOString()
      const shortage = {
        nextRefreshAt,
        reason: "eligible_pool_exhausted" as const,
        requested: 5 as const,
        returned: cards.length,
      }
      await recordPredictionAnalytics(options.database.pool, {
        actorSubjectKey: subjectKey,
        businessKey: `prediction-shortage:${options.uuid.create()}`,
        kind: "shortage",
        occurredAt: now,
        returnedCount: shortage.returned,
      })
      return { cards, shortage }
    },

    predict: async (
      subjectKey: string,
      goalId: string,
      choice: PredictionChoice,
      idempotencyKey: string,
    ): Promise<
      | { readonly prediction: PredictionView; readonly replayed: false }
      | { readonly prediction: PredictionView; readonly replayed: true }
    > => {
      const businessKey = predictionBusinessKey(subjectKey, idempotencyKey)
      const now = options.clock.now()
      const client = await options.database.pool.connect()
      await client.query("begin")
      try {
        const existing = await findPredictionByBusinessKey(client, businessKey)
        if (existing !== undefined) {
          await client.query("commit")
          return predictionReplayOrConflict(existing, subjectKey, goalId, choice)
        }
        const inserted = await client.query<{ readonly insert_prediction: string }>(
          "select insert_prediction($1, $2, $3, $4)::text",
          [goalId, subjectKey, choice, businessKey],
        )
        const prediction = await findPredictionByBusinessKey(client, businessKey)
        if (inserted.rows[0] === undefined || prediction === undefined) {
          throw new TypeError("prediction transaction returned no row")
        }
        await recordPredictionAnalytics(client, {
          actorSubjectKey: subjectKey,
          businessKey: `prediction-submitted:${prediction.id}`,
          choice,
          goalId,
          kind: "submitted",
          occurredAt: now,
        })
        await client.query("commit")
        return { prediction: toPredictionView(prediction), replayed: false }
      } catch (error) {
        await client.query("rollback")
        const racedReplay = await findPredictionByBusinessKey(client, businessKey)
        if (racedReplay !== undefined) {
          return predictionReplayOrConflict(racedReplay, subjectKey, goalId, choice)
        }
        const mapped = predictionServiceError(error)
        if (mapped !== null) throw mapped
        throw error
      } finally {
        client.release()
      }
    },
  }
}

export type PredictionService = ReturnType<typeof createPredictionService>
