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
- Ticket type: `Type: research|prototype|grilling|task`
- Ticket state: `Status: claimed|resolved`
- Dependencies: `Blocked by: NN, NN`
- Resolve by adding an `## Answer`, setting the status to `resolved`, and updating the map.
