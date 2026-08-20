alter table moderation_cases
  add column reporter_subject_key text,
  add column report_reason_code text,
  add column claimed_by text,
  add column claim_expires_at timestamptz,
  add column review_due_at timestamptz,
  add column resolved_at timestamptz,
  add column resolution_reason text,
  add column resolution_business_key text unique,
  add column verdict text check (verdict in ('accepted', 'rejected', 'inconclusive')),
  add column legal_hold_expires_at timestamptz,
  add constraint moderation_hold_bounded check (
    legal_hold_expires_at is null or legal_hold_expires_at <= created_at + interval '7 days'
  );
create unique index moderation_cases_evidence_unique on moderation_cases(evidence_id)
  where evidence_id is not null;
create unique index moderation_cases_open_goal_unique on moderation_cases(goal_id)
  where evidence_id is null and resolved_at is null;

alter table evidences add column resolved_at timestamptz;
alter table evidence_uploads alter column object_key drop not null;
alter table evidence_uploads alter column sha256 drop not null;
alter table evidence_uploads drop constraint evidence_uploads_object_key_check;
alter table evidence_uploads add constraint evidence_uploads_object_key_check
  check (object_key is null or object_key like 'quarantine/%');
alter table evidence_uploads add column bytes_deleted_at timestamptz;
alter table evidence_uploads add column tombstone_expires_at timestamptz;
alter table evidence_uploads add column metadata_purged_at timestamptz;

create table operator_roles (
  subject_key text not null,
  role text not null check (role in ('case_reviewer', 'retention_operator')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (subject_key, role)
);

create table moderation_access_audits (
  id uuid primary key,
  case_id uuid not null references moderation_cases(id),
  operator_subject_key text not null,
  object_key_hash text not null check (object_key_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  accessed_at timestamptz not null
);
create trigger moderation_access_audits_append_only before update or delete on moderation_access_audits
for each row execute function reject_event_mutation();

create table evidence_verdict_events (
  id uuid primary key,
  evidence_id uuid not null references evidences(id),
  operator_subject_key text not null,
  event_kind text not null check (event_kind in ('decision', 'correction')),
  previous_verdict text check (previous_verdict in ('accepted', 'rejected', 'inconclusive')),
  verdict text not null check (verdict in ('accepted', 'rejected', 'inconclusive')),
  reason text not null check (length(btrim(reason)) > 0),
  business_key text not null unique,
  created_at timestamptz not null
);
create trigger evidence_verdict_events_append_only before update or delete on evidence_verdict_events
for each row execute function reject_event_mutation();

create table object_deletion_jobs (
  id uuid primary key,
  evidence_id uuid not null unique references evidences(id),
  source text not null check (source in ('retention', 'account_deletion')),
  state text not null check (state in ('queued', 'running', 'retry', 'completed', 'dead_letter')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 3),
  next_attempt_at timestamptz not null,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null,
  completed_at timestamptz
);

create table operator_alerts (
  id uuid primary key,
  alert_kind text not null check (alert_kind = 'object_delete_dead_letter'),
  deletion_job_id uuid not null unique references object_deletion_jobs(id),
  created_at timestamptz not null,
  acknowledged_at timestamptz
);

create table moderation_retention_aggregates (
  deletion_date date not null,
  deletion_source text not null,
  deleted_count integer not null check (deleted_count > 0),
  primary key (deletion_date, deletion_source)
);
