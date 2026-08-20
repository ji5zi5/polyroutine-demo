# PolyRoutine Design System

## 0. Research Log

- Embedded refs: shortlisted Notion, Airbnb, and Intercom; picked `taste-skill.md` + Notion because a warm, quiet productivity language supports one daily commitment without making the product feel clinical.
- UI/UX database: queried "accountability study habit responsive PWA warm minimal"; retained the single-column, single-primary-action guidance and rejected its exaggerated display scale and multi-accent palette.
- Lazyweb: 2 queries, 4 screens viewed (Atoms, Blinkist, ClickUp, Coursera); retained one dominant goal, direct feedback, and a clearly separated primary action rather than copying visual assets.
- StyleGallery: adopted `center` + `stack`; the document owns scrolling, content has a bounded readable measure, and DOM order remains reading and focus order.
- Imagen drafts: skipped because no image-generation tool is available in this worker runtime. Task 2 is an operational app bootstrap and uses no decorative image substitute.

## 1. Atmosphere & Identity

PolyRoutine is a calm daily checkpoint for adults who want one commitment to feel concrete. The signature is a warm paper-like canvas with a crisp cobalt action and a narrow status rail that makes the current system state unambiguous. Design variance is 4, motion is 2, and density is 4: structured, mostly static, and readable under time pressure.

Primary persona: an adult learner checking one goal on a phone between other tasks. Stress contexts include one-handed use, 200 percent zoom, low vision, temporary distraction, reduced motion, Korean text expansion, and keyboard-only navigation.

## 2. Color

| Role | Token | Light | Dark | Usage |
|---|---|---|---|---|
| Surface primary | `--surface-primary` | `#fffdf9` | `#171715` | Page canvas |
| Surface secondary | `--surface-secondary` | `#f4f1eb` | `#22211f` | Status panels |
| Surface elevated | `--surface-elevated` | `#ffffff` | `#2b2a27` | Focused content |
| Text primary | `--text-primary` | `#242321` | `#f7f4ee` | Headlines and body |
| Text secondary | `--text-secondary` | `#5e5a54` | `#c7c1b8` | Supporting copy |
| Border default | `--border-default` | `#d8d3cb` | `#47443f` | Quiet divisions |
| Accent primary | `--accent-primary` | `#0b63ce` | `#77b7ff` | Links and primary action |
| Accent hover | `--accent-hover` | `#084faa` | `#9acaff` | Hover state |
| Focus | `--focus` | `#005fcc` | `#9acaff` | Focus outline |
| Success | `--status-success` | `#176c45` | `#73d4a7` | Ready state with text |
| Warning | `--status-warning` | `#8a4b08` | `#f2b56d` | Pending state with text |
| Error | `--status-error` | `#b42318` | `#ff9b91` | Error state with text |

Rules: semantic meaning is always written, never color-only. The cobalt ramp is the dominant action color. YES and NO controls may use the existing success/error semantic ramps only when their full text labels remain visible. Components use tokens, not raw color values.

Task 7 extends the palette with `--surface-accent`, soft semantic surfaces, and explicit foreground roles: `--accent-soft`, `--status-success-soft`, `--status-warning-soft`, `--status-error-soft`, and `--text-on-accent`. Light and dark values live only in `tokens.css`; product components consume the semantic names.

## 3. Typography

| Level | Size | Weight | Line Height | Tracking | Usage |
|---|---|---|---|---|---|
| Display | `clamp(2.25rem, 8vw, 4rem)` | 720 | 1.04 | `-0.035em` | Main statement |
| H1 | `2.25rem` | 700 | 1.12 | `-0.025em` | Page heading |
| H2 | `1.5rem` | 680 | 1.25 | `-0.015em` | Panel heading |
| Body large | `1.125rem` | 450 | 1.6 | normal | Lead copy |
| Body | `1rem` | 400 | 1.6 | normal | Default copy |
| Caption | `0.875rem` | 600 | 1.45 | `0.01em` | State labels |

Primary stack: `"Segoe UI Variable", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif`. Mono is unused. Body text never falls below 14px, and lines remain below 68 characters. CSS exposes the table as `--text-display`, `--text-heading-1`, `--text-heading-2`, `--text-body-large`, `--text-body`, and `--text-caption`; components never invent a local font size.

## 4. Spacing & Layout

The base unit is 4px. Tokens: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-6` 24px, `--space-8` 32px, `--space-12` 48px, and `--space-16` 64px. Shape tokens are `--radius-control` 6px, `--radius-panel` 16px, and `--radius-pill` for compact labels. `--target-min` keeps controls at least 44px tall.

StyleGallery `center` bounds onboarding and showcase content at 44rem with fluid 16-32px gutters. The authenticated surface composes `center`, `stack`, and `main-with-rail`: the primary task stays dominant beside a narrow timeline at roomy widths, then source-order reflows to one column below 768px. The browser document is the only scroll owner. At 200 percent zoom the same ordinary document flow is preserved, and every grid track uses `minmax(min(..., 100%), 1fr)` or a single column to prevent horizontal overflow.

## 5. Components

### Status Panel

- **Structure**: semantic section, state label, heading, description, action slot.
- **Variants**: ready, pending, error.
- **Spacing**: `--space-4`, `--space-6`, `--space-8`.
- **States**: each variant uses visible text; actions cover default, hover, active, focus, and disabled. Loading is represented as pending text without looping motion.
- **Accessibility**: heading relationship is explicit, status copy does not rely on color, focus outline is 3px, targets are at least 44px.
- **Motion**: only action color and transform change over 140ms; reduced motion removes transform.
- **Layout**: centered stack; document scroll only.

### Action Link and Button

- **Structure**: semantic anchor or button with concise destination/action label.
- **Variants**: primary, quiet, YES, and NO. Choice variants use semantic color plus written labels and equal visual weight.
- **States**: default, hover, active, focus-visible, disabled, loading, success, and error where the action is asynchronous.
- **Accessibility**: no duplicate intent, no wrapped desktop label, contrast meets WCAG 2.2 AA, and `aria-busy`/live status announces server confirmation.
- **Motion**: 140ms color and one-pixel press feedback, disabled under reduced motion.

### Form Field

- **Structure**: visible label, control, optional helper, then inline error linked with `aria-describedby`.
- **Variants**: text, email, password, number, checkbox.
- **States**: default, hover, focus-visible, invalid, disabled, and submitting.
- **Accessibility**: no placeholder-as-label, browser autocomplete tokens remain accurate, and adult/terms consent uses explicit checkbox labels.

### Today Timeline

- **Structure**: ordered list of named daily stages with current/completed/upcoming text.
- **Layout**: narrow supporting rail on roomy screens, first in DOM and one column on narrow/zoomed screens.
- **Accessibility**: `aria-current="step"` marks only the current stage; state is never a decorative dot alone.

### Goal Panel

- **Structure**: fixed recipe explanation, guided fields, submit action, then a server-confirmed summary.
- **States**: empty, submitting, confirmed, duplicate-day conflict, and request error.
- **Truthfulness**: 25 minutes and the note-line target are the only goal inputs. Server cutoff and evidence deadline are rendered from API timestamps and labeled as server times.

### Prediction Card

- **Structure**: anonymous alias, fixed recipe, server cutoff/deadline, explanation, and equal YES/NO buttons.
- **States**: ready, horizontal drag preview, submitting, server-confirmed, offline retry, and typed conflict replacement.
- **Input parity**: buttons are canonical and available to pointer, keyboard, and screen reader. Horizontal swipe is an additional pointer gesture; it never removes the buttons.
- **Privacy and copy**: no owner identity or crowd result appears before prediction. Copy calls the choice anonymous opinion, not fact, gambling, money, or a guaranteed probability.

### Shortage Panel

- **Structure**: returned/requested count, plain-language reason, server refresh time, and an explicit refresh button.
- **States**: 0-4 cards all use the same truthful panel; no skeleton or fake card fills missing inventory.
- **Behavior**: shortage never blocks goal progress or claims five cards are guaranteed.

### Offline and Goal History

- **Structure**: an explicit offline status precedes the daily grid; the most recent confirmed goal appears in a separate `이전 목표 기록` surface when the server has no goal for the current local day.
- **Isolation**: cached goal records are keyed by the authenticated subject and API responses are never placed in the shared service-worker cache.
- **Mutation state**: signup, goal creation, prediction, refresh, retry, and logout actions are unavailable offline with written `연결 후` labels; no action is queued silently.
- **Next local day**: the prior confirmed goal remains readable while the empty current-day goal form opens. Creating the new goal does not erase the prior record.

The `/showcase` route remains the primitive state harness. Task 7 extends it with form, action, timeline, prediction, and shortage states before those primitives are accepted on the product screen.

## 6. Motion & Interaction

Micro feedback lasts 140ms with ease-out and only changes transform, opacity, or color. There is no decorative or perpetual animation. Async buttons keep the control in place while text and `aria-busy` communicate progress. Prediction cards follow the consulted beui.dev swipe mechanism at lower intensity: `touch-action: pan-y` preserves document scroll, direct pointer movement updates a transform without React rerenders, release beyond 22 percent of card width submits the visible choice, and any shorter drag returns to rest. A server response, never the drag itself, removes a card. `prefers-reduced-motion: reduce` removes transform and transition. Focus remains visible independently of hover, and pointer feedback is not required to understand state.

## 7. Depth & Surface

Strategy: mixed tonal shift plus whisper border. Panels use `--surface-secondary`, a 1px `--border-default` line, and one low-opacity ambient shadow token. Buttons use a 6px radius; panels use 16px. Pill shapes are reserved for compact state labels.

## 8. Accessibility Constraints & Accepted Debt

Target WCAG 2.2 AA: 4.5:1 body contrast, 3:1 large text, 44px targets, visible keyboard focus, semantic landmarks, zoom-safe flow, Korean language metadata, and reduced-motion support. Plain language states what happened and what action is available. Task 7 additionally requires keyboard-only signup, goal creation, YES/NO prediction, refresh, and offline retry; critical axe violations are zero at 360px and 1280px. Offline mode preserves the readable shell and account-scoped confirmed history while disabling every server mutation rather than pretending it was queued. The primary learner persona must complete the flow one-handed without swipe, at 200 percent zoom without two-dimensional scrolling, and after a dropped response without remembering whether a vote was stored. No accepted accessibility or design debt exists through Task 7.
