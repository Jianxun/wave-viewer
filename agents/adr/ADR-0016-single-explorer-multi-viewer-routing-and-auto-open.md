# ADR-0016: Single Explorer, Multi-Viewer Routing, and Auto-Open Commands

## Status
Accepted

## Context
Current command flows still fail when no viewer is focused/open for some actions (notably `Open Layout` and side-panel add actions), even though host state is dataset-scoped and viewer sessions are already managed separately. This creates avoidable UX dead-ends and inconsistent behavior across command entry points.

At the same time, users need one explorer to drive multiple live viewers, including mixed-dataset comparison workspaces.

## Decision
- Keep a single global explorer panel for loaded datasets/signals.
- Support multiple concurrent viewer sessions and route explorer actions host-side.
- Standardize command behavior:
  - commands requiring a viewer must auto-open one when no eligible session exists;
  - `Open Layout` must succeed without pre-focused viewer;
  - dataset-load flow must resolve/create default layout then open a bound viewer.
- Require layout-open flow to register referenced datasets into explorer state automatically.

## Consequences
- Removes “focus viewer first” failure class from normal workflows.
- Makes explorer-to-viewer dispatch deterministic while preserving host-authoritative state.
- Increases host orchestration complexity around session routing, binding transitions, and autosave/watch ordering.

## Alternatives
- One explorer per viewer:
  - Rejected because it duplicates UI state and complicates loaded-dataset management.
- Keep current viewer-required errors:
  - Rejected because it interrupts primary workflows and violates command consistency.
