import { type AnalyticsEvent, analyticsEventSchema } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"

type DatabaseClient = Pick<DatabaseHandle["pool"], "query">

type CohortContextRow = {
  readonly local_cohort_date: string
  readonly timezone: string
}

type OutboxRow = {
  readonly event_name: string
  readonly id: string
  readonly payload: unknown
  readonly schema_version: number
}

export type AnalyticsCohortContext = {
  readonly actorSubjectKey: string
  readonly localCohortDate: string
  readonly timezone: string
}

export type AnalyticsEventSink = {
  readonly publish: (event: AnalyticsEvent) => Promise<void>
}

export type PublishAnalyticsResult =
  | { readonly delivery: "deferred"; readonly eventId: string }
  | { readonly delivery: "idle" }
  | { readonly delivery: "published"; readonly eventId: string }

type AppendAnalyticsEvent = {
  readonly businessKey: string
  readonly event: AnalyticsEvent
  readonly occurredAt: Date
}

export async function analyticsCohortContext(
  client: DatabaseClient,
  actorSubjectKey: string,
  occurredAt: Date,
): Promise<AnalyticsCohortContext> {
  const result = await client.query<CohortContextRow>(
    `select timezone, to_char($2 at time zone timezone, 'YYYY-MM-DD') as local_cohort_date
     from users where subject_key = $1`,
    [actorSubjectKey, occurredAt],
  )
  const row = result.rows[0]
  if (row === undefined) throw new TypeError("analytics actor does not exist")
  return {
    actorSubjectKey,
    localCohortDate: row.local_cohort_date,
    timezone: row.timezone,
  }
}

export async function appendAnalyticsEvent(
  client: DatabaseClient,
  input: AppendAnalyticsEvent,
): Promise<void> {
  await client.query("select try_append_analytics_event($1, $2, $3, $4::jsonb, $5)", [
    input.event.eventName,
    input.businessKey,
    input.event.eventVersion,
    JSON.stringify(input.event),
    input.occurredAt,
  ])
}

export async function publishPendingAnalyticsEvent(
  database: DatabaseHandle,
  sink: AnalyticsEventSink,
): Promise<PublishAnalyticsResult> {
  const client = await database.pool.connect()
  await client.query("begin")
  try {
    const selected = await client.query<OutboxRow>(
      `select id::text, event_name, schema_version, payload from analytics_events
       where published_at is null order by occurred_at, event_sequence for update skip locked limit 1`,
    )
    const row = selected.rows[0]
    if (row === undefined) {
      await client.query("commit")
      return { delivery: "idle" }
    }
    const parsed = analyticsEventSchema.safeParse(row.payload)
    if (!parsed.success || parsed.data.eventName !== row.event_name || row.schema_version !== 1) {
      throw new TypeError("analytics outbox row violates the V1 event contract")
    }
    try {
      await sink.publish(parsed.data)
    } catch (error) {
      await client.query("rollback")
      if (error instanceof Error) return { delivery: "deferred", eventId: row.id }
      throw error
    }
    await client.query(
      "update analytics_events set published_at = clock_timestamp() where id = $1",
      [row.id],
    )
    await client.query("commit")
    return { delivery: "published", eventId: row.id }
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}
