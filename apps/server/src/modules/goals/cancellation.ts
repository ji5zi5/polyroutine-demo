import type { Clock } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import { analyticsCohortContext, appendAnalyticsEvent } from "../analytics/index.js"
import type { CancelGoalInput, GoalView } from "./contract.js"
import { GoalServiceError } from "./contract.js"
import { type DatabaseClient, findOwnedGoal, type GoalRow, toGoalView } from "./records.js"

export type CancelCommand = {
  readonly goalId: string
  readonly idempotencyKey: string
  readonly input: CancelGoalInput
  readonly subjectKey: string
}

type CancellationDependencies = {
  readonly clock: Clock
  readonly database: DatabaseHandle
}

type CancelledGoalRow = GoalRow & {
  readonly previous_state: "prediction_open" | "evidence_open"
}

type CancellationPolicy = {
  readonly ownerCancellation: boolean
  readonly reason: string | null
}

function assertNever(value: never): never {
  throw new TypeError(`unexpected cancellation variant: ${String(value)}`)
}

function cancellationPolicy(input: CancelGoalInput): CancellationPolicy {
  switch (input.actor) {
    case "owner":
      return { ownerCancellation: true, reason: null }
    case "operator":
      return { ownerCancellation: false, reason: input.reason }
    default:
      return assertNever(input)
  }
}

async function cancellationReplay(
  client: DatabaseClient,
  goalId: string,
): Promise<GoalRow | undefined> {
  const result = await client.query<GoalRow>(
    `select g.id::text, g.owner_subject_key, g.local_goal_date::text, g.recipe_id,
       g.recipe_version, g.goal_copy, g.prediction_cutoff_at, g.evidence_deadline_at, g.state
     from analytics_events a join goals g on g.id::text = a.payload->>'goalId'
     where a.event_name = 'goal_terminal' and a.payload->>'goalId' = $1
       and a.payload->>'terminalState' = 'cancelled'`,
    [goalId],
  )
  return result.rows[0]
}

export async function cancelGoal(
  dependencies: CancellationDependencies,
  command: CancelCommand,
): Promise<GoalView> {
  const now = dependencies.clock.now()
  const client = await dependencies.database.pool.connect()
  await client.query("begin")
  try {
    const replayed = await cancellationReplay(client, command.goalId)
    if (replayed !== undefined) {
      await client.query("commit")
      return toGoalView(replayed)
    }
    const policy = cancellationPolicy(command.input)
    const result = await client.query<CancelledGoalRow>(
      `with eligible as (
         select id, state as previous_state from goals
         where id = $1 and state not in ('completed', 'failed', 'expired', 'cancelled')
           and ($2::boolean = false or
             (owner_subject_key = $3 and state = 'prediction_open' and prediction_cutoff_at > $4
              and not exists (select 1 from predictions where goal_id = goals.id)))
         for update
       )
       update goals set state = 'cancelled' from eligible
       where goals.id = eligible.id
       returning goals.id::text, goals.owner_subject_key, goals.local_goal_date::text,
         goals.recipe_id, goals.recipe_version, goals.goal_copy, goals.prediction_cutoff_at,
         goals.evidence_deadline_at, goals.state, eligible.previous_state`,
      [command.goalId, policy.ownerCancellation, command.subjectKey, now],
    )
    const row = result.rows[0]
    if (row === undefined) {
      const concurrentReplay = await cancellationReplay(client, command.goalId)
      if (concurrentReplay !== undefined) {
        await client.query("commit")
        return toGoalView(concurrentReplay)
      }
      await findOwnedGoal(dependencies.database, command.subjectKey, command.goalId)
      throw new GoalServiceError("GOAL_IMMUTABLE", 409, "goal can no longer be cancelled")
    }
    const quorum = await client.query<{ readonly count: string }>(
      "select count(*)::text as count from predictions where goal_id = $1",
      [command.goalId],
    )
    const cohort = await analyticsCohortContext(client, row.owner_subject_key, now)
    await appendAnalyticsEvent(client, {
      businessKey: `goal-terminal:${command.goalId}:cancelled`,
      event: {
        ...cohort,
        eventName: "goal_terminal",
        eventVersion: 1,
        goalId: command.goalId,
        quorumCount: Number(quorum.rows[0]?.count ?? "0"),
        reasonCode: command.input.actor === "owner" ? "owner_cancelled" : "operator_cancelled",
        recipeId: "study_note_photo_v1",
        recipeVersion: 1,
        terminalState: "cancelled",
      },
      occurredAt: now,
    })
    await client.query("commit")
    return toGoalView(row)
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}
