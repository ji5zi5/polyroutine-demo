import type { DatabaseHandle } from "@polyroutine/db"
import { settleTerminalGoal } from "../settlement/reputation.js"

type DatabaseClient = Pick<DatabaseHandle["pool"], "query">

type LifecycleOptions = {
  readonly database: DatabaseHandle
  readonly now: Date
}

type GoalEvidenceRow = {
  readonly accepted: boolean
  readonly evidence_count: string
  readonly evidence_deadline_at: Date
  readonly goal_id: string
  readonly rejected_count: string
}

type TerminalGoalState = "completed" | "failed" | "expired"

type Transition =
  | {
      readonly fromState: "prediction_open"
      readonly goalId: string
      readonly reasonCode: null
      readonly toState: "evidence_open"
    }
  | {
      readonly fromState: "evidence_open"
      readonly goalId: string
      readonly reasonCode:
        | "accepted_evidence"
        | "evidence_missing"
        | "rejected_evidence"
        | "verdict_unresolved"
      readonly toState: TerminalGoalState
    }

async function applyTransition(
  client: DatabaseClient,
  transition: Transition,
  now: Date,
): Promise<void> {
  if (transition.toState !== "evidence_open") {
    await settleTerminalGoal({
      actor: "scheduler",
      client,
      goalId: transition.goalId,
      now,
      reasonCode: transition.reasonCode,
      state: transition.toState,
    })
    return
  }
  await client.query("update goals set state = $1 where id = $2 and state = $3", [
    transition.toState,
    transition.goalId,
    transition.fromState,
  ])
}

export async function runGoalLifecycle(options: LifecycleOptions): Promise<void> {
  const client = await options.database.pool.connect()
  await client.query("begin")
  try {
    const cutoffs = await client.query<{ readonly goal_id: string }>(
      `select id::text as goal_id from goals
       where state = 'prediction_open' and prediction_cutoff_at <= $1
       order by prediction_cutoff_at, id for update`,
      [options.now],
    )
    for (const { goal_id: goalId } of cutoffs.rows) {
      await applyTransition(
        client,
        { fromState: "prediction_open", goalId, reasonCode: null, toState: "evidence_open" },
        options.now,
      )
    }

    const candidates = await client.query<GoalEvidenceRow>(
      `with locked_goals as materialized (
         select id, evidence_deadline_at from goals where state = 'evidence_open' for update
       )
       select g.id::text as goal_id, g.evidence_deadline_at,
         count(e.id)::text as evidence_count,
         count(e.id) filter (where e.state = 'rejected')::text as rejected_count,
         coalesce(bool_or(e.state = 'accepted'), false) as accepted
       from locked_goals g left join evidences e on e.goal_id = g.id
       group by g.id, g.evidence_deadline_at order by g.id`,
    )
    for (const row of candidates.rows) {
      let toState: TerminalGoalState | null = null
      const evidenceCount = Number(row.evidence_count)
      const rejectedCount = Number(row.rejected_count)
      let reasonCode: Exclude<Transition["reasonCode"], null> | null = null
      if (row.accepted) {
        toState = "completed"
        reasonCode = "accepted_evidence"
      } else if (
        rejectedCount >= 2 ||
        (rejectedCount > 0 && options.now >= row.evidence_deadline_at)
      ) {
        toState = "failed"
        reasonCode = "rejected_evidence"
      } else if (evidenceCount === 0 && options.now >= row.evidence_deadline_at) {
        toState = "expired"
        reasonCode = "evidence_missing"
      } else if (
        evidenceCount > 0 &&
        options.now.getTime() >= row.evidence_deadline_at.getTime() + 15 * 60 * 1_000
      ) {
        toState = "expired"
        reasonCode = "verdict_unresolved"
      }
      if (toState !== null && reasonCode !== null) {
        await applyTransition(
          client,
          { fromState: "evidence_open", goalId: row.goal_id, reasonCode, toState },
          options.now,
        )
      }
    }
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}
