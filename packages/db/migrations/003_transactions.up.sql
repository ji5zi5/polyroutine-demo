create function insert_prediction(
  requested_goal_id uuid,
  requested_predictor text,
  requested_choice text,
  requested_business_key text
) returns uuid language plpgsql as $$
declare locked_goal goals%rowtype; prediction_id uuid;
begin
  select * into locked_goal from goals where id = requested_goal_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'PR_GOAL_NOT_FOUND'; end if;
  if locked_goal.owner_subject_key = requested_predictor then
    raise exception using errcode = 'P0001', message = 'PR_SELF_PREDICTION';
  end if;
  if locked_goal.state <> 'prediction_open' or clock_timestamp() >= locked_goal.prediction_cutoff_at then
    raise exception using errcode = 'P0001', message = 'PR_PREDICTION_CUTOFF';
  end if;
  if exists (select 1 from predictions where goal_id = requested_goal_id and predictor_subject_key = requested_predictor) then
    raise exception using errcode = 'P0001', message = 'PR_DUPLICATE_PREDICTION';
  end if;
  if exists (select 1 from predictions where business_key = requested_business_key) then
    raise exception using errcode = 'P0001', message = 'PR_DUPLICATE_BUSINESS_KEY';
  end if;
  insert into predictions(goal_id, predictor_subject_key, choice, business_key)
  values (requested_goal_id, requested_predictor, requested_choice, requested_business_key)
  returning id into prediction_id;
  return prediction_id;
end;
$$;

create function transition_goal(
  requested_goal_id uuid,
  requested_state text,
  actor_kind text,
  cancellation_reason text
) returns void language plpgsql as $$
declare locked_goal goals%rowtype;
begin
  select * into locked_goal from goals where id = requested_goal_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'PR_GOAL_NOT_FOUND'; end if;
  if locked_goal.state in ('completed', 'failed', 'expired', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'PR_TERMINAL_IMMUTABLE';
  end if;
  if requested_state = 'cancelled' then
    if actor_kind = 'owner' and clock_timestamp() >= locked_goal.prediction_cutoff_at then
      raise exception using errcode = 'P0001', message = 'PR_OWNER_CANCEL_CUTOFF';
    end if;
    if actor_kind = 'operator' and nullif(btrim(cancellation_reason), '') is null then
      raise exception using errcode = 'P0001', message = 'PR_OPERATOR_CANCEL_REASON_REQUIRED';
    end if;
    if actor_kind not in ('owner', 'operator') then
      raise exception using errcode = 'P0001', message = 'PR_CANCEL_ACTOR_INVALID';
    end if;
  elsif requested_state = 'evidence_open' then
    if locked_goal.state <> 'prediction_open' or clock_timestamp() < locked_goal.prediction_cutoff_at then
      raise exception using errcode = 'P0001', message = 'PR_TRANSITION_CUTOFF';
    end if;
  elsif locked_goal.state <> 'evidence_open' or requested_state not in ('completed', 'failed', 'expired') then
    raise exception using errcode = 'P0001', message = 'PR_INVALID_GOAL_TRANSITION';
  end if;
  update goals set state = requested_state where id = requested_goal_id;
end;
$$;

create function receive_evidence(
  requested_goal_id uuid,
  requested_owner text,
  requested_business_key text
) returns uuid language plpgsql as $$
declare locked_goal goals%rowtype; next_attempt integer; evidence_id uuid;
begin
  select * into locked_goal from goals where id = requested_goal_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'PR_GOAL_NOT_FOUND'; end if;
  if locked_goal.owner_subject_key <> requested_owner then
    raise exception using errcode = 'P0001', message = 'PR_EVIDENCE_OWNER_MISMATCH';
  end if;
  if clock_timestamp() >= locked_goal.evidence_deadline_at then
    raise exception using errcode = 'P0001', message = 'PR_EVIDENCE_DEADLINE';
  end if;
  select count(*) + 1 into next_attempt from evidences where goal_id = requested_goal_id;
  if next_attempt > 2 then
    raise exception using errcode = 'P0001', message = 'PR_EVIDENCE_ATTEMPTS_EXHAUSTED';
  end if;
  insert into evidences(goal_id, owner_subject_key, attempt_number, business_key)
  values (requested_goal_id, requested_owner, next_attempt, requested_business_key)
  returning id into evidence_id;
  return evidence_id;
end;
$$;

create function mark_evidence_state(requested_evidence_id uuid, requested_state text)
returns void language plpgsql as $$
declare receipt evidences%rowtype; deadline timestamptz;
begin
  select * into receipt from evidences where id = requested_evidence_id for update;
  select evidence_deadline_at into deadline from goals where id = receipt.goal_id for update;
  if receipt.received_at > deadline or clock_timestamp() > deadline + interval '15 minutes' then
    raise exception using errcode = 'P0001', message = 'PR_EVIDENCE_PROCESSING_GRACE_EXPIRED';
  end if;
  update evidences set state = requested_state where id = requested_evidence_id;
end;
$$;

create function append_goal_correction(
  requested_goal_id uuid,
  requested_operator text,
  requested_state text,
  requested_reason text,
  requested_business_key text
) returns uuid language plpgsql as $$
declare correction_id uuid;
begin
  perform 1 from goals where id = requested_goal_id and state in ('completed', 'failed', 'expired', 'cancelled') for update;
  if not found then raise exception using errcode = 'P0001', message = 'PR_CORRECTION_REQUIRES_TERMINAL'; end if;
  insert into goal_correction_events(goal_id, operator_subject_key, corrected_state, reason, business_key)
  values (requested_goal_id, requested_operator, requested_state, requested_reason, requested_business_key)
  returning id into correction_id;
  return correction_id;
end;
$$;
