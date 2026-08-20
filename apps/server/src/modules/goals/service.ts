import type { Clock, UuidFactory } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import { analyticsCohortContext, appendAnalyticsEvent } from "../analytics/index.js"
import { type CancelCommand, cancelGoal } from "./cancellation.js"
import { GoalServiceError, type GoalView, type GuidedGoalFields } from "./contract.js"
import { findOwnedGoal, type GoalRow, toGoalView } from "./records.js"
import { calculateGoalSchedule, localDateAt } from "./schedule.js"

type GoalServiceOptions = {
  readonly clock: Clock
  readonly database: DatabaseHandle
  readonly uuid: UuidFactory
}

export type GoalService = {
  readonly cancel: (command: CancelCommand) => Promise<GoalView>
  readonly create: (subjectKey: string, fields: GuidedGoalFields) => Promise<GoalView>
  readonly get: (subjectKey: string, goalId: string) => Promise<GoalView>
  readonly today: (subjectKey: string) => Promise<GoalView | null>
  readonly update: (
    subjectKey: string,
    goalId: string,
    fields: GuidedGoalFields,
  ) => Promise<GoalView>
}

async function timezoneFor(database: DatabaseHandle, subjectKey: string): Promise<string> {
  const result = await database.pool.query<{ readonly timezone: string }>(
    "select timezone from users where subject_key = $1",
    [subjectKey],
  )
  const timezone = result.rows[0]?.timezone
  if (timezone === undefined) {
    throw new GoalServiceError("SUBJECT_NOT_FOUND", 404, "subject does not exist")
  }
  return timezone
}

export function createGoalService(options: GoalServiceOptions): GoalService {
  return {
    cancel: async (command) => cancelGoal(options, command),
    create: async (subjectKey, fields) => {
      const now = options.clock.now()
      const timezone = await timezoneFor(options.database, subjectKey)
      const schedule = calculateGoalSchedule(now)
      const id = options.uuid.create()
      const client = await options.database.pool.connect()
      await client.query("begin")
      try {
        const result = await client.query<GoalRow>(
          `insert into goals(id, owner_subject_key, local_goal_date, recipe_id, recipe_version,
             goal_copy, prediction_cutoff_at, evidence_deadline_at)
           values ($1, $2, $3, 'study_note_photo_v1', 1, $4, $5, $6)
           on conflict (owner_subject_key, local_goal_date) do nothing
           returning id::text, owner_subject_key, local_goal_date::text, recipe_id, recipe_version,
             goal_copy, prediction_cutoff_at, evidence_deadline_at, state`,
          [
            id,
            subjectKey,
            localDateAt(now, timezone),
            JSON.stringify(fields),
            schedule.predictionCutoffAt,
            schedule.evidenceDeadlineAt,
          ],
        )
        const row = result.rows[0]
        if (row === undefined) {
          throw new GoalServiceError("DAILY_GOAL_EXISTS", 409, "daily goal already exists")
        }
        const priorTerminalGoal = await client.query<{ readonly exists: boolean }>(
          `select exists(
             select 1 from goals
             where owner_subject_key = $1 and local_goal_date = $2::date - 1
               and state in ('completed', 'failed', 'expired', 'cancelled')
           )`,
          [subjectKey, row.local_goal_date],
        )
        if (priorTerminalGoal.rows[0]?.exists === true) {
          const cohort = await analyticsCohortContext(client, subjectKey, now)
          await appendAnalyticsEvent(client, {
            businessKey: `next-day-goal-created:${id}`,
            event: {
              ...cohort,
              eventName: "next_day_goal_created",
              eventVersion: 1,
              goalId: id,
              recipeId: "study_note_photo_v1",
              recipeVersion: 1,
            },
            occurredAt: now,
          })
        }
        await client.query("commit")
        return toGoalView(row)
      } catch (error) {
        await client.query("rollback")
        throw error
      } finally {
        client.release()
      }
    },
    get: async (subjectKey, goalId) =>
      toGoalView(await findOwnedGoal(options.database, subjectKey, goalId)),
    today: async (subjectKey) => {
      const timezone = await timezoneFor(options.database, subjectKey)
      const result = await options.database.pool.query<GoalRow>(
        `select id::text, owner_subject_key, local_goal_date::text, recipe_id, recipe_version,
           goal_copy, prediction_cutoff_at, evidence_deadline_at, state
         from goals where owner_subject_key = $1 and local_goal_date = $2`,
        [subjectKey, localDateAt(options.clock.now(), timezone)],
      )
      const row = result.rows[0]
      return row === undefined ? null : toGoalView(row)
    },
    update: async (subjectKey, goalId, fields) => {
      const result = await options.database.pool.query<GoalRow>(
        `update goals set goal_copy = $1
         where id = $2 and owner_subject_key = $3 and state = 'prediction_open'
           and prediction_cutoff_at > $4
           and not exists (select 1 from predictions where goal_id = goals.id)
         returning id::text, owner_subject_key, local_goal_date::text, recipe_id, recipe_version,
           goal_copy, prediction_cutoff_at, evidence_deadline_at, state`,
        [JSON.stringify(fields), goalId, subjectKey, options.clock.now()],
      )
      const row = result.rows[0]
      if (row !== undefined) return toGoalView(row)
      await findOwnedGoal(options.database, subjectKey, goalId)
      throw new GoalServiceError("GOAL_IMMUTABLE", 409, "goal can no longer be updated")
    },
  }
}
