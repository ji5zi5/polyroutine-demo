create function normalize_local_time(
  requested_local timestamp,
  requested_timezone text,
  explicit_utc_offset_minutes integer default null
) returns timestamptz language plpgsql stable as $$
declare
  canonical timestamptz;
  candidate timestamptz;
  candidate_count integer;
begin
  if not exists (select 1 from pg_timezone_names where name = requested_timezone) then
    raise exception using errcode = 'P0001', message = 'PR_INVALID_TIMEZONE';
  end if;
  canonical := requested_local at time zone requested_timezone;
  if canonical at time zone requested_timezone <> requested_local then
    raise exception using errcode = 'P0001', message = 'PR_DST_NONEXISTENT';
  end if;
  select count(*) into candidate_count
  from generate_series(canonical - interval '3 hours', canonical + interval '3 hours', interval '1 minute') instant
  where instant at time zone requested_timezone = requested_local;
  if candidate_count > 1 and explicit_utc_offset_minutes is null then
    raise exception using errcode = 'P0001', message = 'PR_DST_AMBIGUOUS';
  end if;
  if explicit_utc_offset_minutes is null then return canonical; end if;
  candidate := (requested_local - make_interval(mins => explicit_utc_offset_minutes)) at time zone 'UTC';
  if candidate at time zone requested_timezone <> requested_local then
    raise exception using errcode = 'P0001', message = 'PR_INVALID_UTC_OFFSET';
  end if;
  return candidate;
end;
$$;

create function protect_goal() returns trigger language plpgsql as $$
begin
  if old.state in ('completed', 'failed', 'expired', 'cancelled') and new.state <> old.state then
    raise exception using errcode = 'P0001', message = 'PR_TERMINAL_IMMUTABLE';
  end if;
  if clock_timestamp() >= old.prediction_cutoff_at and
    (new.recipe_id, new.recipe_version, new.goal_copy, new.prediction_cutoff_at, new.evidence_deadline_at)
      is distinct from
    (old.recipe_id, old.recipe_version, old.goal_copy, old.prediction_cutoff_at, old.evidence_deadline_at) then
    raise exception using errcode = 'P0001', message = 'PR_GOAL_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger goals_protect before update on goals for each row execute function protect_goal();

create function enforce_prediction_insert() returns trigger language plpgsql as $$
declare locked_goal goals%rowtype;
begin
  select * into locked_goal from goals where id = new.goal_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PR_GOAL_NOT_FOUND';
  end if;
  if locked_goal.owner_subject_key = new.predictor_subject_key then
    raise exception using errcode = 'P0001', message = 'PR_SELF_PREDICTION';
  end if;
  if locked_goal.state <> 'prediction_open' or clock_timestamp() >= locked_goal.prediction_cutoff_at then
    raise exception using errcode = 'P0001', message = 'PR_PREDICTION_CUTOFF';
  end if;
  return new;
end;
$$;
create trigger predictions_enforce_insert before insert on predictions
for each row execute function enforce_prediction_insert();

create function reject_event_mutation() returns trigger language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = 'PR_APPEND_ONLY';
end;
$$;
create trigger reputation_events_append_only before update or delete on reputation_events
for each row execute function reject_event_mutation();
create trigger correction_events_append_only before update or delete on goal_correction_events
for each row execute function reject_event_mutation();
create trigger analytics_events_append_only before update or delete on analytics_events
for each row execute function reject_event_mutation();
