-- Each query binds $1 = window_start and $2 = window_end as server UTC timestamptz values.

-- cohort: listing_to_submission
with first_listings as (
  select distinct on (payload->>'actorSubjectKey', payload->>'goalId')
    payload->>'actorSubjectKey' as actor_subject_key,
    payload->>'goalId' as goal_id,
    occurred_at as listed_at
  from analytics_events
  where event_name = 'goal_listed' and occurred_at >= $1 and occurred_at < $2
  order by payload->>'actorSubjectKey', payload->>'goalId', occurred_at
), submitted_goals as (
  select payload->>'goalId' as goal_id, min(occurred_at) as submitted_at
  from analytics_events
  where event_name = 'evidence_submitted'
  group by payload->>'goalId'
)
select
  count(*)::integer as denominator,
  count(*) filter (where submitted_at > listed_at)::integer as numerator,
  count(*)::integer as sample_size,
  min(listed_at) as observation_started_at,
  max(listed_at) as observation_ended_at
from first_listings
left join submitted_goals using (goal_id);

-- cohort: submission_to_terminal
with submitted_goals as (
  select payload->>'goalId' as goal_id, min(occurred_at) as submitted_at
  from analytics_events
  where event_name = 'evidence_submitted' and occurred_at >= $1 and occurred_at < $2
  group by payload->>'goalId'
), terminal_goals as (
  select payload->>'goalId' as goal_id, min(occurred_at) as terminal_at
  from analytics_events
  where event_name = 'goal_terminal'
  group by payload->>'goalId'
)
select
  count(*)::integer as denominator,
  count(*) filter (where terminal_at > submitted_at)::integer as numerator,
  count(*)::integer as sample_size,
  min(submitted_at) as observation_started_at,
  max(submitted_at) as observation_ended_at
from submitted_goals
left join terminal_goals using (goal_id);

-- cohort: terminal_completion
select
  count(distinct payload->>'goalId')::integer as denominator,
  count(distinct payload->>'goalId') filter (
    where payload->>'terminalState' = 'completed'
  )::integer as numerator,
  count(distinct payload->>'goalId')::integer as sample_size,
  min(occurred_at) as observation_started_at,
  max(occurred_at) as observation_ended_at
from analytics_events
where event_name = 'goal_terminal' and occurred_at >= $1 and occurred_at < $2;

-- cohort: next_local_day_goal
with terminal_subject_days as (
  select
    payload->>'actorSubjectKey' as actor_subject_key,
    payload->>'timezone' as timezone,
    (payload->>'localCohortDate')::date as cohort_date,
    min(occurred_at) as terminal_at
  from analytics_events
  where event_name = 'goal_terminal' and occurred_at >= $1 and occurred_at < $2
  group by actor_subject_key, timezone, cohort_date
), next_day_creators as (
  select distinct
    payload->>'actorSubjectKey' as actor_subject_key,
    payload->>'timezone' as timezone,
    (payload->>'localCohortDate')::date as cohort_date
  from analytics_events
  where event_name = 'next_day_goal_created'
)
select
  count(*)::integer as denominator,
  count(*) filter (where next_day_creators.actor_subject_key is not null)::integer as numerator,
  count(*)::integer as sample_size,
  min(terminal_at) as observation_started_at,
  max(terminal_at) as observation_ended_at
from terminal_subject_days
left join next_day_creators
  on next_day_creators.actor_subject_key = terminal_subject_days.actor_subject_key
  and next_day_creators.timezone = terminal_subject_days.timezone
  and next_day_creators.cohort_date = terminal_subject_days.cohort_date + 1;

-- cohort: active_retention
with activity_events as (
  select
    payload->>'actorSubjectKey' as actor_subject_key,
    payload->>'timezone' as timezone,
    (payload->>'localCohortDate')::date as cohort_date,
    min(occurred_at) as first_activity_at
  from analytics_events
  where event_name in (
    'goal_listed', 'prediction_submitted', 'evidence_submitted', 'next_day_goal_created'
  )
  group by actor_subject_key, timezone, cohort_date
), baseline_days as (
  select * from activity_events where first_activity_at >= $1 and first_activity_at < $2
), retention_days as (
  select retention_day from (values (1), (7)) as configured(retention_day)
)
select
  baseline.cohort_date,
  configured.retention_day,
  count(*)::integer as denominator,
  count(follow_up.actor_subject_key)::integer as numerator,
  count(*)::integer as sample_size,
  min(baseline.first_activity_at) as observation_started_at,
  max(baseline.first_activity_at) as observation_ended_at
from baseline_days baseline
cross join retention_days configured
left join activity_events follow_up
  on follow_up.actor_subject_key = baseline.actor_subject_key
  and follow_up.timezone = baseline.timezone
  and follow_up.cohort_date = baseline.cohort_date + configured.retention_day
group by baseline.cohort_date, configured.retention_day
order by baseline.cohort_date, configured.retention_day;
