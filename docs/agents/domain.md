# Domain Docs

Breef uses a single-context documentation layout.

## Before exploring

Read:

- `CONTEXT.md` at the repository root when present
- `docs/context/PROJECT_CONTEXT.md`
- `docs/domain/GLOSSARY.md`
- Relevant ADRs under `docs/decisions/`

If `CONTEXT.md` does not exist, proceed silently. The domain-modeling flow creates it when terminology needs to be resolved.

## Use established vocabulary

Use terms defined in `CONTEXT.md` and `docs/domain/GLOSSARY.md`. Avoid introducing synonyms for established concepts.

If a required concept is missing, note it for domain modeling rather than silently inventing terminology.

## Respect architecture decisions

Read ADRs affecting the area being changed. If proposed work contradicts an accepted ADR, identify the conflict explicitly instead of silently overriding it.
