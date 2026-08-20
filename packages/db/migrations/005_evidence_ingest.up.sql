alter table evidence_challenges
  add column signal_kind text not null default 'replay_reduction_only'
    check (signal_kind = 'replay_reduction_only');

create table evidence_uploads (
  evidence_id uuid primary key references evidences(id) on delete cascade,
  object_key text not null unique check (object_key like 'quarantine/%'),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 8388608),
  width integer not null check (width between 1 and 8192),
  height integer not null check (height between 1 and 8192),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  duplicate_signal boolean not null,
  challenge_id uuid not null unique references evidence_challenges(id),
  exif_stripped boolean not null check (exif_stripped),
  created_at timestamptz not null default clock_timestamp()
);

create index evidence_uploads_sha256_idx on evidence_uploads(sha256);
