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

create table evidence_verdict_events (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references evidences(id),
  review_id uuid not null references operator_reviews(id),
  operator_subject_key text not null,
  verdict text not null check (verdict in ('accepted', 'rejected', 'inconclusive')),
  reason_code text,
  terminal_state text check (terminal_state in ('completed', 'failed', 'expired', 'cancelled')),
  business_key text not null unique,
  resolved_at timestamptz not null,
  check ((verdict = 'accepted' and reason_code is null) or
    (verdict = 'rejected' and reason_code in
      ('recipe_mismatch', 'challenge_not_visible', 'notes_insufficient')) or
    (verdict = 'inconclusive' and reason_code in
      ('image_unreadable', 'review_unavailable')))
);
create unique index evidence_verdict_events_evidence_idx
  on evidence_verdict_events(evidence_id);
create trigger evidence_verdict_events_append_only
before update or delete on evidence_verdict_events
for each row execute function reject_event_mutation();
