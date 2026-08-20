alter table analytics_events
  add column event_sequence bigint generated always as identity,
  add column schema_version smallint not null default 1 check (schema_version = 1),
  add constraint analytics_events_event_name_check check (event_name in (
    'goal_listed',
    'prediction_exposed',
    'prediction_submitted',
    'prediction_shortage_shown',
    'evidence_submitted',
    'verdict_resolved',
    'goal_terminal',
    'reputation_event_appended',
    'next_day_goal_created'
  ));

create index analytics_events_pending_publication_idx
  on analytics_events(occurred_at, event_sequence) where published_at is null;

create function try_append_analytics_event(
  requested_event_name text,
  requested_business_key text,
  requested_schema_version smallint,
  requested_payload jsonb,
  requested_occurred_at timestamptz
) returns boolean language plpgsql as $$
begin
  insert into analytics_events(event_name, business_key, schema_version, payload, occurred_at)
  values (
    requested_event_name,
    requested_business_key,
    requested_schema_version,
    requested_payload,
    requested_occurred_at
  );
  return true;
exception when others then
  return false;
end;
$$;

create or replace function reject_event_mutation() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'analytics_events' and to_jsonb(old)->>'published_at' is null and
    to_jsonb(new)->>'published_at' is not null and
    to_jsonb(new) - 'published_at' = to_jsonb(old) - 'published_at' then
    return new;
  end if;
  if current_setting('poly_routine.account_deletion', true) = 'on' and
    ((tg_table_name = 'reputation_events' and
      to_jsonb(new) - 'subject_key' = to_jsonb(old) - 'subject_key') or
     (tg_table_name = 'goal_correction_events' and
      to_jsonb(new) - 'operator_subject_key' = to_jsonb(old) - 'operator_subject_key')) then
    return new;
  end if;
  raise exception using errcode = 'P0001', message = 'PR_APPEND_ONLY';
end;
$$;
