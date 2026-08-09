# Task 19 / P1-03: Create shared configuration, validation, and redaction conventions

Type: task
Status: needs-triage
Blocked by: 17
GitHub issue: #21
Parent GitHub epic: #3
Parent GitHub specification: #2
GitHub dependencies: Task 17 → #19

## Status

Not started; tracker state is planned until dependencies resolve.

## User Story

As a Breev operator, I want invalid configuration rejected and secrets redacted consistently, so that every app fails safely without exposing credentials or patient data.

## Phase

Phase 1 — Foundation

## Module

Validation and platform configuration

## Goal

All apps inherit strict TypeScript, lint, formatting, test, environment-schema, and redacted-config conventions.

## Source requirements

- US-098; REQ-ARCH-004–007, REQ-NFR-003–006; ADR-002; P1-03

## Preconditions

- Task 17 resolved.

## Scope

- Shared strict TS/lint/format/test baselines with documented override rules.
- Typed environment validation separating required, optional, public, and secret values.
- Central redaction rules and normalized configuration errors; negative fixtures.

## Out of scope

- Production secrets manager selection, domain-specific configuration, runtime logging pipeline.

## Files likely affected

- Root/shared config files; `packages/validation`; app configuration adapters; example environment docs.

## Data changes

- None.

## API or IPC changes

- A shared configuration/error contract may be introduced; no business API or IPC capability.

## Security considerations

- Renderer bundles must never receive server-only values; redaction is mandatory at every error/log seam.

## Offline and sync considerations

- Local startup validates without contacting cloud; no synchronization behavior.

## Accounting and inventory impact

- None.

## Test plan

- Missing/invalid/unknown config, secret redaction, renderer bundle inspection, locale-safe normalized errors.

## Acceptance criteria

- Given valid local configuration and no internet, when an app starts, then validation succeeds without a cloud call.
- Given a missing or malformed required value, when startup runs, then it stops before binding/listening and reports the field without its secret value.
- Given logs/errors containing known secret shapes, when redaction runs, then no raw secret appears in output or renderer bundles.

## Documentation updates

- Document environment ownership, classification, and safe example values.

## Risks

- An app may bypass shared config or a public prefix may expose a secret.

## Completion evidence

- Record config checks, negative fixtures, renderer inspection, and secret-scan output.
