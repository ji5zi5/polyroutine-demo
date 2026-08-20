# Daily-loop analytics cohorts

All event times are server UTC. `actorSubjectKey` is a pseudonymous subject key, never an email, session token, image identifier, object key, or free text. `localCohortDate` and `timezone` are calculated by the server for that subject at emission. Event payloads are V1 strict schemas in `@polyroutine/contracts`; unrecognized fields are rejected.

The transactional `analytics_events` outbox is the source of these cohorts. Delivery failure leaves an unpublished row for retry and never changes goal, prediction, verdict, or settlement outcomes. The current ADR sets readiness to `omit`: no readiness or shadow event, table, route, adapter, or UI exists.

## Definitions

- **Listing to evidence submission:** denominator is each distinct `(actorSubjectKey, goalId)` first `goal_listed` event in the observation window. Numerator is denominator goals with any later `evidence_submitted` event for the goal. This measures listed goals reaching an owner receipt, not an individual viewer submitting their own evidence.
- **Submission to terminal:** denominator is each distinct goal with `evidence_submitted` in the observation window. Numerator is denominator goals with a later `goal_terminal` event. Pending receipts outside the observation window remain in the denominator and are reported separately by age.
- **Completion rate:** denominator is distinct terminal goals in the observation window. Numerator is denominator goals whose `goal_terminal.terminalState = completed`. This is explicitly a terminal-outcome share, not a claim about all created goals.
- **Next-local-day new goal:** denominator is a subject's terminal goals on local date D. Numerator is those subjects with `next_day_goal_created` on local date D+1 in the same timezone. A subject counts once per D.
- **D+1 / D+7 active:** denominator is distinct subjects with an activity event on local date D. Activity is `goal_listed`, `prediction_submitted`, `evidence_submitted`, or `next_day_goal_created`. Numerator is denominator subjects with any activity on local date D+1 or D+7 in their own recorded timezone.

Every dashboard query returns its denominator, numerator, sample size, and minimum/maximum observed UTC event time. It must not display a 68% completion or D+7 45% benchmark.

Exact query templates live in [cohorts.sql](./cohorts.sql).
