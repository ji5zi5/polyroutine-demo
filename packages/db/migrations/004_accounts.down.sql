drop trigger if exists account_deletion_audits_append_only on account_deletion_audits;
drop table if exists account_deletion_audits;
drop table if exists account_deletion_jobs;
drop table if exists login_rate_limits;
drop index if exists sessions_family_idx;
drop index if exists sessions_subject_active_idx;
alter table sessions
  drop column if exists replaced_by_session_id,
  drop column if exists csrf_hash,
  drop column if exists family_id;
drop table if exists accounts;
create or replace function reject_event_mutation() returns trigger language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = 'PR_APPEND_ONLY';
end;
$$;
