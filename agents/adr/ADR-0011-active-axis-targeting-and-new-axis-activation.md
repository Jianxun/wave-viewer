# ADR-0011: Active-Axis Targeting and New-Axis Activation

## Status
Proposed

## Context
Signal add commands currently rely on implied/default axis resolution, which can diverge across side-panel commands, quick-add, and drag/drop flows. This inconsistency contributes to user confusion and routing bugs.

The workflow needs one explicit notion of "current target axis" per plot.

## Decision
- Introduce `activeAxisByPlotId` as authoritative viewer interaction state (host-owned).
- Use active axis as default target for:
  - Explorer `Add to Plot`
  - Explorer quick-add (double-click)
- Define deterministic fallback when active axis is invalid:
  - reassignment target (if provided by operation), else first axis in plot, else create one axis.
- Define invariant for new-axis operations:
  - after successful `Add to New Axis`, newly created axis becomes active axis for that plot.
- Apply above semantics uniformly across side-panel commands and drag/drop new-axis flows.

## Consequences
- Predictable, user-visible targeting behavior for all signal add paths.
- Reduced risk of accidental trace placement on unexpected axes.
- Additional host state to maintain when axes are removed/reordered.

## Alternatives
- Keep implicit "first axis" default only:
  - Rejected because it ignores user targeting intent and does not scale with multi-axis workflows.
- Keep separate targeting rules per entry path:
  - Rejected because semantic drift creates regression risk and higher cognitive load.
