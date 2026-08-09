# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are individual files under `.scratch/<feature-slug>/issues/`
- Tickets are numbered from `01`: `<NN>-<slug>.md`
- Triage state is recorded using a `Status:` line
- Comments are appended under a `## Comments` heading

## Publishing and fetching

When publishing an issue, create the appropriate file under `.scratch/<feature-slug>/`.

When fetching a ticket, read the referenced issue file.

## Wayfinding operations

- Map: `.scratch/<effort>/map.md`
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`
- Ticket type: `Type: epic|research|prototype|grilling|task`
- Ticket state uses the canonical local triage vocabulary from `triage-labels.md` (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, or `wontfix`) plus the local execution states `claimed` and `resolved`.
- An `epic` describes a gated product outcome and is never executed as one change.
- A `task` is one reviewable implementation slice and must use the task format in the governing master prompt.
- Every task starts with a user story (`As a …, I want …, so that …`) and carries source requirements, dependencies, acceptance scenarios, test scope, risks, and completion evidence.
- `ready-for-agent` means the task is sufficiently specified and has passed its planning prerequisites; this repository still requires explicit initiation before it becomes `claimed`. Gated future epics and dependency-blocked tasks remain `needs-triage` while their delivery map records the more specific planned state and dependency.
- Dependencies: `Blocked by: NN, NN`
- Resolve by adding an `## Answer`, setting the status to `resolved`, and updating the map.
