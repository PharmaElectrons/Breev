# Breev working agreement

Before designing or changing behavior, read [`docs/README.md`](docs/README.md), the root [`CONTEXT.md`](CONTEXT.md), the relevant product, domain, or workflow section, and any applicable ADR.

## Engineering rules

- Do not preserve backward compatibility with the prototype, empty scaffold, obsolete documentation, or superseded identifiers. Remove obsolete paths instead of adding aliases, fallbacks, adapters, or one-off migration layers. Use forward database migrations and bounded sync-version handling to protect live Breev data, not to retain obsolete application paths.
- Choose the simplest implementation that fully satisfies current requirements. Avoid speculative abstractions, configuration, extension points, and indirection.
- Build one working end-to-end layer at a time. Finish the smallest usable vertical slice before adding another capability. Do not trade working software for a broad set of unfinished code.
- Keep modules cohesive, separate concerns, and keep interfaces narrow. Start each domain boundary as a module boundary. Do not automatically make it a workspace package, process, repository interface, or event.
- Prefer established, well-maintained libraries when they reduce total complexity or improve reliability. Before adding code or a package, inspect the current documentation and types for existing dependencies. Use all relevant capabilities they already provide.
- Choose solutions meant to last. Do not knowingly add temporary fixes.
- Before designing a solution, research established products that have solved the same problem successfully. Compare their constraints with Breev's offline-first pharmacy constraints. Adopt a pattern only when that comparison shows it fits Breev.
- Preserve the non-negotiable integrity boundaries in [`docs/domain.md`](docs/domain.md) and [`docs/architecture.md`](docs/architecture.md): renderer isolation, narrow preload IPC, server-authoritative operations, atomic posting, immutable snapshots/corrections, inventory movements, exact money, audit, tenant/permission/entitlement enforcement, and offline Free Core.
- Keep pending legal, accountant, pharmacist, privacy, security, provider, and release decisions open. A precedent is evidence, not authority to decide regulated behavior.

## Source and scope authority

Use the hierarchy in [`docs/README.md`](docs/README.md#source-authority) and its evidence map in [`docs/traceability.md`](docs/traceability.md). Explicit later stakeholder decisions outrank older briefs. Confirmed requirements outrank implementation convenience. Treat prototype code only as visual or workflow evidence. Do not recover excluded or deferred features merely because an old route, package, or document mentions them.

The current public name is **Breev**. Use `breev` and `@breev/*` for new implementation identifiers. Historical `Breef` spellings remain only in the fixed Git source baseline. Do not add compatibility exports for them.

## Repository and documentation

- Follow the target shape in [`docs/architecture.md`](docs/architecture.md) only as the codebase earns it. Do not create a workspace, deployable, worker, interface, provider registry, or event bus until its stated extraction test passes.
- Place tests beside their owning code. Test through the narrow public module or transport seam. Use real PostgreSQL for persistence, concurrency, RLS, and transaction behavior.
- Keep root `CONTEXT.md` as the single glossary. Keep product rules in `docs/product.md`, invariants in `docs/domain.md`, procedures in `docs/workflows.md`, technical boundaries in `docs/architecture.md`, gates in `docs/open-decisions.md`, and delivery/quality rules in their named files. Link instead of duplicating prose.
- Create an ADR only for a consequential decision that is hard to reverse and has real alternatives. Explicitly update or supersede the ADR when the decision changes.
- Documentation changes must reconcile their requirement families in [`docs/traceability.md`](docs/traceability.md). Never silently weaken, invent, or promote a requirement.

## Local issue tracking

Issues live in `.scratch/<feature-slug>/` and use `spec.md`, an optional `map.md`, and `issues/<NN>-<slug>.md`. Start numbering at `01`. A task includes a user story, source requirements, dependencies (`Blocked by: NN`), acceptance scenarios, test scope, risks, and completion evidence. An epic is a gated outcome. Do not execute it as one change.

Use `Type: epic|research|prototype|grilling|task` and one of these statuses: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, `claimed`, or `resolved`. `ready-for-agent` still requires explicit initiation. Resolve by adding `## Answer`, setting `Status: resolved`, and updating the map. Append discussion under `## Comments`.

## Completion

Apply [`docs/quality.md`](docs/quality.md) to every change. A compiling happy path is not enough. Also test the relevant permissions, entitlements, tenant/device boundaries, transaction failures, offline/restart states, and Arabic/English accessibility. All must pass, and the change must include completion evidence.
