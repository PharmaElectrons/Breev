# ADR 0001: Earn workspace and process boundaries

**Status:** Accepted, 2026-08-23

## Context

The scaffold defines five app workspaces and twenty-five package workspaces, but none contains behavior. Every source file exports a name constant. Business concepts need clear owners. An npm workspace earns its cost only when code has multiple consumers or needs its own release, privilege, availability, or scaling boundary.

## Decision

Begin with `desktop`, `local-api`, and the cross-runtime `contracts` package. Add `cloud-api` when M4 implements paid subscription and licence issuance. Extend the same app later for sync.

Keep each local domain in a cohesive feature module inside `local-api`. Expose narrow public operations, keep tables private, reject dependency cycles and disallowed imports, and test through those operations. Delete all marker packages and apps. Do not add compatibility exports.

## Extraction test

The operative test lives in [`architecture.md`](../architecture.md): a workspace requires two real consumers that need the same semantics and evolve independently, meaningful complexity, and the fact that removal would force duplication or exposure. Create a separate process only when evidence shows an independent lifecycle or a measured need for separate availability, privilege, release, or scaling.

## Alternatives considered

- Keep one package per domain or concept. This makes the taxonomy visible but creates thirty build and public interfaces without shared behavior.
- Add a framework-free `core` workspace. It becomes useful only if a second runtime executes local domain logic. Current authority requires `local-api` to own that logic.
- Use microservices or workers. They conflict with local atomicity and add deployment and failure modes.

## Consequences

Code boundaries and tests enforce modularity, not the npm workspace structure. Each app owns its database lifecycle. `contracts` contains wire schemas, not shared entities. A later extraction requires evidence and must pass this ADR's test. A domain name alone does not justify extraction.
