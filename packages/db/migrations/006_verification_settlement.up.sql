alter table goal_correction_events
  add column sequence_number bigint generated always as identity;
create unique index goal_correction_events_sequence_idx
  on goal_correction_events(sequence_number);

create table operator_reviews (
  id uuid primary key,
  evidence_id uuid not null unique references evidences(id) on delete cascade,
  state text not null default 'queued'
    check (state in ('queued', 'leased', 'decided', 'exhausted')),
  lease_attempts smallint not null default 0 check (lease_attempts between 0 and 3),
  leased_by text,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  check ((state = 'leased') =
    (leased_by is not null and lease_token is not null and lease_expires_at is not null)),
  check ((state = 'decided') = (decided_at is not null))
);
create index operator_reviews_claim_idx on operator_reviews(state, created_at, id);

alter table evidence_verdict_events
  alter column id set default gen_random_uuid(),
  alter column event_kind drop not null,
  alter column reason drop not null,
  alter column created_at drop not null,
  add column review_id uuid unique references operator_reviews(id),
  add column reason_code text,
  add column terminal_state text check (
    terminal_state in ('completed', 'failed', 'expired', 'cancelled')
  ),
  add column resolved_at timestamptz;
