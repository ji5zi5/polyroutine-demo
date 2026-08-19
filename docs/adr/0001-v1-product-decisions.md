# ADR 0001: V1 product and operating decisions

- Status: Accepted
- Date: 2026-08-19
- Machine contract: `0001-v1-product-decisions.json`

## Context

V1 needs one build target and bounded operating rules before implementation. This ADR replaces the proposal's broad audience, generic goals, AI probability claims, and point economy with a narrow testable product contract.

## Decisions

### Client

V1 is a responsive web PWA. Its selected client root is `apps/web`, using Next.js PWA and Playwright. No mobile or native client is selected.

### Evidence recipe and capture

The sole recipe is `study_note_photo_v1`, version 1:

> 오늘 25분 학습 후 서버가 준 코드와 최소 3줄의 당일 학습 노트를 한 프레임에 촬영

In English: after studying for 25 minutes today, photograph the server-provided code and at least three lines of today's study notes in one frame.

Capture uses a server-guided challenge that expires after 10 minutes. It is only a replay-reduction signal. It doesn't prove liveness, authenticity, or completion.

### Readiness and verdict

Readiness AI is omitted. V1 has no readiness adapter, schema, route, or UI. Evidence receives a `bounded operator review`; no dormant AI verdict provider is part of this decision.

### Feed consistency

Predictions use an atomic, immutable insert with no reservation lease. A user has at most one effective YES or NO prediction per goal.

### Reputation

Reputation is derived, non-transferable, non-redeemable, and not money. Completion adds 10. A successful goal adds 5 only when predictions had a strict NO majority. A tie or zero votes earns no bonus.

### Retention

Evidence bytes are deleted within 24 hours after a terminal verdict. Pending evidence, reported evidence, and legal holds may retain bytes for at most 7 days. Tombstone and audit metadata are retained for 90 days. These are upper bounds, not indefinite extensions.

### Cost and audience

Monthly operating cost is capped at 100000 KRW. The cap is finite. V1 is adults-only and requires adult self-attestation; it isn't identity or age verification.

## Consequences

Implementations must use `apps/web` wherever the plan names `<selected-client-root>`. They must not add another client, a generic recipe, readiness UI, reservation leases, redeemable points, or unbounded data retention. Paid services must fit under the monthly cap.

Changes to these choices require a later ADR and a matching machine contract change.
