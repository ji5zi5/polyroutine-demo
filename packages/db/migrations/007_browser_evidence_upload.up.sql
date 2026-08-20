create table evidence_upload_intents (
  id uuid primary key,
  goal_id uuid not null references goals(id) on delete cascade,
  owner_subject_key text not null,
  challenge_id uuid not null unique references evidence_challenges(id) on delete cascade,
  attempt_number smallint not null check (attempt_number between 1 and 2),
  business_key text not null unique,
  idempotency_key text not null,
  object_key text not null unique check (object_key like 'quarantine-pending/%'),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 8388608),
  expires_at timestamptz not null,
  completed_evidence_id uuid unique references evidences(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);

create index evidence_upload_intents_goal_idx
  on evidence_upload_intents(goal_id, owner_subject_key);
