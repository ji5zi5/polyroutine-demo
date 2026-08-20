drop trigger if exists evidence_verdict_events_append_only on evidence_verdict_events;
drop table if exists evidence_verdict_events;
drop index if exists operator_reviews_claim_idx;
drop table if exists operator_reviews;
drop index if exists goal_correction_events_sequence_idx;
alter table goal_correction_events drop column if exists sequence_number;
