create extension if not exists pgcrypto;

create function require_iana_timezone() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception using errcode = 'P0001', message = 'PR_INVALID_TIMEZONE';
  end if;
  return new;
end;
$$;

create table users (
  subject_key text primary key,
  timezone text not null,
  created_at timestamptz not null default clock_timestamp()
);
create trigger users_require_iana_timezone before insert or update of timezone on users
for each row execute function require_iana_timezone();

create table sessions (
  id uuid primary key default gen_random_uuid(),
  subject_key text not null references users(subject_key),
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  owner_subject_key text not null references users(subject_key),
  local_goal_date date not null,
  recipe_id text not null check (recipe_id = 'study_note_photo_v1'),
  recipe_version integer not null check (recipe_version = 1),
  goal_copy text not null,
  prediction_cutoff_at timestamptz not null,
  evidence_deadline_at timestamptz not null,
  state text not null default 'prediction_open'
    check (state in ('prediction_open', 'evidence_open', 'completed', 'failed', 'expired', 'cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  unique (owner_subject_key, local_goal_date),
  check (prediction_cutoff_at < evidence_deadline_at)
);

create table predictions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id),
  predictor_subject_key text not null,
  choice text not null check (choice in ('yes', 'no')),
  business_key text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (predictor_subject_key, goal_id)
);

create table feed_exposures (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id),
  viewer_subject_key text not null,
  business_key text not null unique,
  exposed_at timestamptz not null default clock_timestamp()
);

create table evidence_challenges (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id),
  owner_subject_key text not null,
  attempt_number smallint not null check (attempt_number between 1 and 2),
  challenge_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (goal_id, attempt_number)
);

create table evidences (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id),
  owner_subject_key text not null,
  attempt_number smallint not null check (attempt_number between 1 and 2),
  business_key text not null unique,
  state text not null default 'received'
    check (state in ('received', 'pending', 'accepted', 'rejected', 'inconclusive')),
  received_at timestamptz not null default clock_timestamp(),
  unique (goal_id, attempt_number)
);

create table verification_jobs (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references evidences(id),
  attempt_number smallint not null check (attempt_number between 1 and 3),
  state text not null check (state in ('queued', 'running', 'completed', 'failed')),
  business_key text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (evidence_id, attempt_number)
);

create table moderation_cases (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid references evidences(id),
  goal_id uuid references goals(id),
  state text not null default 'clear'
    check (state in ('clear', 'quarantined', 'reported', 'removed')),
  reason text,
  created_at timestamptz not null default clock_timestamp(),
  check (evidence_id is not null or goal_id is not null)
);

create table reputation_events (
  id uuid primary key default gen_random_uuid(),
  subject_key text not null,
  business_key text not null unique,
  event_kind text not null check (event_kind in ('award', 'correction')),
  points integer not null,
  reference_business_key text,
  reason text,
  created_at timestamptz not null default clock_timestamp(),
  check ((event_kind = 'award' and reference_business_key is null) or
    (event_kind = 'correction' and reference_business_key is not null and reason is not null))
);

create table goal_correction_events (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id),
  operator_subject_key text not null,
  corrected_state text not null check (corrected_state in ('completed', 'failed', 'expired', 'cancelled')),
  reason text not null check (length(btrim(reason)) > 0),
  business_key text not null unique,
  created_at timestamptz not null default clock_timestamp()
);

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  business_key text not null unique,
  payload jsonb not null,
  occurred_at timestamptz not null default clock_timestamp(),
  published_at timestamptz
);
