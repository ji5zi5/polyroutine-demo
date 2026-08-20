alter table evidence_verdict_events
  drop column if exists resolved_at,
  drop column if exists terminal_state,
  drop column if exists reason_code,
  drop column if exists review_id,
  alter column id drop default;
drop index if exists operator_reviews_claim_idx;
drop table if exists operator_reviews;
drop index if exists goal_correction_events_sequence_idx;
alter table goal_correction_events drop column if exists sequence_number;
