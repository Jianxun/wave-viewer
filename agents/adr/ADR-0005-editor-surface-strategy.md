# ADR-0005: Editor Surface Strategy for MVP

## Status
Accepted

## Context
VaporView uses a custom editor (`viewType`) as the main interaction surface. Wave Viewer currently uses a command-opened webview panel. Migrating now could improve integration, but it also adds platform-level complexity while side-panel-first workflows and protocol stabilization are still in flight.

We need a clear stance for MVP planning to avoid mixing two architectural migrations at once.

## Decision
- Keep command-opened webview panel as the editor surface for MVP and near-term side-panel migration tasks.
- Defer custom editor migration until the side-panel-first workflow refactor is implemented and stabilized.
- Revisit custom editor adoption only after side-panel workflow stabilization criteria and protocol tests are satisfied.

## Consequences
- Preserves delivery focus on interaction and determinism improvements.
- Delays potential custom-editor UX benefits (document affinity, editor lifecycle alignment).
- Creates a clear boundary for current tasks and avoids concurrent high-risk refactors.

## Alternatives
- Migrate to custom editor immediately:
  - Rejected due to compounded migration risk and schedule uncertainty.
- Never migrate to custom editor:
  - Rejected because it prematurely closes an option that may become valuable after MVP stabilization.
