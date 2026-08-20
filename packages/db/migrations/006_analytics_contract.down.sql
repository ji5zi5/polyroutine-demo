drop function if exists try_append_analytics_event(text, text, smallint, jsonb, timestamptz);
drop index if exists analytics_events_pending_publication_idx;
alter table analytics_events
  drop constraint if exists analytics_events_event_name_check,
  drop column if exists event_sequence,
  drop column if exists schema_version;

create or replace function reject_event_mutation() returns trigger language plpgsql as $$
begin
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
