# Task 21 / P1-05: Build the bilingual accessible desktop UI foundation

Type: task
Status: needs-triage
Blocked by: 19, 20
GitHub issue: #23
Parent GitHub epic: #3
Parent GitHub specification: #2
GitHub dependencies: Tasks 19–20 → #21, #22

## Status

Not started; tracker state is planned until dependencies resolve.

## User Story

As a pharmacy staff member, I want a readable Arabic/RTL or English/LTR desktop shell with clear offline and error states, so that I can understand system status without depending on color, direction assumptions, or a mouse.

## Phase

Phase 1 — Foundation

## Module

Desktop UI, `packages/ui`, and `packages/i18n`

## Goal

The shared shell demonstrates locale/direction, theme, keyboard focus, accessibility semantics, and standard loading/disabled/offline/error states without pharmacy domain screens.

## Source requirements

- US-006–009; REQ-UX-001–004, REQ-UX-008–010, REQ-NFR-045–049; ADR-027; P1-05

## Preconditions

- Tasks 19–20 resolved; prototype used only as visual reference.

## Scope

- AR/EN locale and document direction switching; light/dark tokens.
- Keyboard-operable shell, visible focus, error boundary, accessible status region and reusable state components.
- Smoke fixtures for four locale/theme combinations and 200% text.

## Out of scope

- Porting prototype routes, full POS design, business permissions/entitlements, final release certification.

## Files likely affected

- `apps/desktop` renderer shell; `packages/ui`; `packages/i18n`; UI/accessibility tests.

## Data changes

- Local presentation preferences only if required; no domain persistence.

## API or IPC changes

- None beyond consuming the existing foundation status contract.

## Security considerations

- Status and error UI must not reveal configuration, credentials, stack traces, or sensitive payloads.

## Offline and sync considerations

- All foundation states work offline; no synchronization behavior.

## Accounting and inventory impact

- None.

## Test plan

- Keyboard-only, focus, names/roles/status, direction/order, theme/contrast, 200% resize, reduced motion, offline/error snapshots.

## Acceptance criteria

- Given Arabic or English is selected, when the shell renders, then direction, focus order, labels, and status announcements match that language.
- Given keyboard-only use and 200% text, when every foundation control/state is traversed, then no control or critical message is lost or obscured.
- Given local service unavailable or offline state, when status changes, then a non-color-only accessible explanation and recovery action appear without discarding UI state.

## Documentation updates

- Update keyboard and accessibility workflow notes.

## Risks

- Visual direction may flip while logical keyboard/focus order remains incorrect.

## Completion evidence

- Attach four locale/theme smoke results, 200% text evidence, keyboard trace, and automated accessibility output.
