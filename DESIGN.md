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

Rules: semantic meaning is always written, never color-only. The cobalt ramp is the only saturated interaction color. Components use tokens, not raw color values.

## 3. Typography

| Level | Size | Weight | Line Height | Tracking | Usage |
|---|---|---|---|---|---|
| Display | `clamp(2.25rem, 8vw, 4rem)` | 720 | 1.04 | `-0.035em` | Main statement |
| H1 | `2.25rem` | 700 | 1.12 | `-0.025em` | Page heading |
| H2 | `1.5rem` | 680 | 1.25 | `-0.015em` | Panel heading |
| Body large | `1.125rem` | 450 | 1.6 | normal | Lead copy |
| Body | `1rem` | 400 | 1.6 | normal | Default copy |
| Caption | `0.875rem` | 600 | 1.45 | `0.01em` | State labels |

Primary stack: `"Segoe UI Variable", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif`. Mono is unused. Body text never falls below 14px, and lines remain below 68 characters.

## 4. Spacing & Layout

The base unit is 4px. Tokens: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-6` 24px, `--space-8` 32px, `--space-12` 48px, and `--space-16` 64px.

StyleGallery `center` bounds primary content at 44rem with fluid 16-32px gutters. `stack` owns vertical rhythm. The browser document is the only scroll owner. At widths below 768px every region remains one column; at 200 percent zoom the same ordinary document flow is preserved.

## 5. Components

### Status Panel

- **Structure**: semantic section, state label, heading, description, action slot.
- **Variants**: ready, pending, error.
- **Spacing**: `--space-4`, `--space-6`, `--space-8`.
- **States**: each variant uses visible text; actions cover default, hover, active, focus, and disabled. Loading is represented as pending text without looping motion.
- **Accessibility**: heading relationship is explicit, status copy does not rely on color, focus outline is 3px, targets are at least 44px.
- **Motion**: only action color and transform change over 140ms; reduced motion removes transform.
- **Layout**: centered stack; document scroll only.

### Action Link

- **Structure**: semantic anchor with concise destination label.
- **Variants**: primary and quiet.
- **States**: default, hover, active, focus-visible, disabled equivalent via button where needed.
- **Accessibility**: no duplicate intent, no wrapped desktop label, contrast meets WCAG 2.2 AA.
- **Motion**: 140ms transform and color feedback, disabled under reduced motion.

The `/showcase` route is the primitive state harness and must pass before product screens expand.

## 6. Motion & Interaction

Micro feedback lasts 140ms with ease-out and only changes transform or color. There is no decorative or perpetual animation. `prefers-reduced-motion: reduce` removes transform and transition. Focus remains visible independently of hover, and pointer feedback is not required to understand state.

## 7. Depth & Surface

Strategy: mixed tonal shift plus whisper border. Panels use `--surface-secondary`, a 1px `--border-default` line, and one low-opacity ambient shadow token. Buttons use a 6px radius; panels use 16px. Pill shapes are reserved for compact state labels.

## 8. Accessibility Constraints & Accepted Debt

Target WCAG 2.2 AA: 4.5:1 body contrast, 3:1 large text, 44px targets, visible keyboard focus, semantic landmarks, zoom-safe flow, Korean language metadata, and reduced-motion support. Plain language states what happened and what action is available. No accepted accessibility or design debt exists for Task 2.
