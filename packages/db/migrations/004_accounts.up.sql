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

create table accounts (
  subject_key text primary key references users(subject_key),
  email_normalized text not null unique check (email_normalized = lower(btrim(email_normalized))),
  password_hash text not null check (password_hash like '$argon2id$%'),
  adult_self_attested_at timestamptz not null,
  terms_version text not null check (length(btrim(terms_version)) > 0),
  privacy_version text not null check (length(btrim(privacy_version)) > 0),
  created_at timestamptz not null default clock_timestamp()
);

alter table sessions
  add column family_id uuid not null default gen_random_uuid(),
  add column csrf_hash text not null default encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
  add column replaced_by_session_id uuid references sessions(id);
create index sessions_subject_active_idx on sessions(subject_key) where revoked_at is null;
create index sessions_family_idx on sessions(family_id);

create table login_rate_limits (
  rate_key_hash text primary key,
  failure_count smallint not null check (failure_count >= 0),
  window_started_at timestamptz not null,
  blocked_until timestamptz
);

create table account_deletion_jobs (
  id uuid primary key,
  tombstone_subject_key text not null references users(subject_key),
  job_kind text not null check (job_kind = 'delete_account_images'),
  state text not null default 'queued' check (state in ('queued', 'running', 'completed', 'failed')),
  goal_ids jsonb not null check (jsonb_typeof(goal_ids) = 'array'),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

create table account_deletion_audits (
  id uuid primary key default gen_random_uuid(),
  tombstone_subject_key text not null references users(subject_key),
  image_deletion_job_id uuid not null references account_deletion_jobs(id),
  cancelled_goal_count integer not null check (cancelled_goal_count >= 0),
  result text not null check (result = 'pii_removed_sessions_revoked'),
  created_at timestamptz not null default clock_timestamp()
);
create trigger account_deletion_audits_append_only
before update or delete on account_deletion_audits
for each row execute function reject_event_mutation();
