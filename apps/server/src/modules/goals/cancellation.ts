import type { Clock } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
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
  businessKey: string,
): Promise<GoalRow | undefined> {
  const result = await client.query<GoalRow>(
    `select g.id::text, g.owner_subject_key, g.local_goal_date::text, g.recipe_id,
       g.recipe_version, g.goal_copy, g.prediction_cutoff_at, g.evidence_deadline_at, g.state
     from analytics_events a join goals g on g.id::text = a.payload->>'goalId'
     where a.business_key = $1`,
    [businessKey],
  )
  return result.rows[0]
}

export async function cancelGoal(
  dependencies: CancellationDependencies,
  command: CancelCommand,
): Promise<GoalView> {
  const now = dependencies.clock.now()
  const businessKey = `goal:${command.goalId}:cancel:${command.idempotencyKey}`
  const client = await dependencies.database.pool.connect()
  await client.query("begin")
  try {
    const replayed = await cancellationReplay(client, businessKey)
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
      const concurrentReplay = await cancellationReplay(client, businessKey)
      if (concurrentReplay !== undefined) {
        await client.query("commit")
        return toGoalView(concurrentReplay)
      }
      await findOwnedGoal(dependencies.database, command.subjectKey, command.goalId)
      throw new GoalServiceError("GOAL_IMMUTABLE", 409, "goal can no longer be cancelled")
    }
    await client.query(
      `insert into analytics_events(event_name, business_key, payload, occurred_at)
       values ('goal_transitioned', $1, $2::jsonb, $3)`,
      [
        businessKey,
        JSON.stringify({
          actor: command.input.actor,
          fromState: row.previous_state,
          goalId: command.goalId,
          reason: policy.reason,
          toState: "cancelled",
        }),
        now,
      ],
    )
    await client.query("commit")
    return toGoalView(row)
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}
