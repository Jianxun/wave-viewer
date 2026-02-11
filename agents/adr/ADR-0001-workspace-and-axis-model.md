# ADR-0001: Workspace and Axis Model for MVP

## Status
Accepted

## Context
Wave Viewer must support exploratory plotting from CSV and deterministic replay from YAML specs. Early design choices around workspace layout, signal assignment, and axis modeling will strongly shape UI, state management, and serialization.

Multiple viable approaches were considered:
- Plot organization via tabs or tiled dashboards.
- Signal-centric toggles versus trace-instance modeling.
- Fixed two-axis state versus extensible axis identifiers.

These choices are expensive to reverse after parser, state, and spec formats are implemented.

## Decision
- MVP workspace uses plot **tabs** (not tiled dashboards).
- Plotting is modeled via **trace instances**, where each trace binds one signal to one axis.
- Axis identifiers are extensible and stable as `y1..yN` in state and spec models.
- Deterministic YAML replay is a first-class requirement: exported specs must capture rendering-relevant workspace state (plots, axes, traces, order, ranges, visibility).

## Consequences
- Simpler MVP UX and state transitions than tiled layouts, with lower implementation risk.
- Same signal can be plotted on multiple axes naturally by creating multiple trace instances.
- Adapter and spec logic must support generic N-axis mapping from the start.

## Alternatives
- Tiled/scrollable multi-canvas workspace for MVP:
  - Rejected due to higher UI/state complexity and reduced delivery confidence for MVP.
- Hardcoded `y`/`y2` data model:
  - Rejected because near-term multi-axis requirements would force disruptive schema/state refactors.
