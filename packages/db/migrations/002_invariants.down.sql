drop trigger if exists analytics_events_append_only on analytics_events;
drop trigger if exists correction_events_append_only on goal_correction_events;
drop trigger if exists reputation_events_append_only on reputation_events;
drop function if exists reject_event_mutation();
drop trigger if exists predictions_enforce_insert on predictions;
drop function if exists enforce_prediction_insert();
drop trigger if exists goals_protect on goals;
drop function if exists protect_goal();
drop function if exists normalize_local_time(timestamp, text, integer);
