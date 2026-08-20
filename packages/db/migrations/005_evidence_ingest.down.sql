drop index if exists evidence_uploads_sha256_idx;
drop table if exists evidence_uploads;
alter table evidence_challenges drop column if exists signal_kind;
