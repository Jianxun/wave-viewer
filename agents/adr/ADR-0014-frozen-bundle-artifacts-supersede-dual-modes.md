# ADR-0014: Frozen Bundle Artifacts Supersede Dual Spec Modes

## Status
Accepted

## Context
Dual persistence modes (`reference-only` vs `portable-archive`) add branching complexity in schema and UX. At the same time, users need a reproducible snapshot workflow without disrupting interactive layout sessions bound to active datasets/layout files.

MVP needs one interactive schema and one explicit archival path that does not mutate active layout bindings.

## Decision
- Supersede `ADR-0007` dual-mode persistence.
- Keep interactive layout persistence as dataset-referenced layout YAML only.
- Add frozen export as a separate artifact pair:
  - `<name>.frozen.csv`: reduced dataset for selected plots/signals.
  - `<name>.frozen.wave-viewer.yaml`: layout that references the frozen CSV.
- Frozen export MUST NOT rebind or overwrite the active interactive layout/session.

## Consequences
- Eliminates schema-level dual-mode branching while preserving reproducible sharing/archival workflow.
- Improves user safety: exporting frozen artifacts cannot break ongoing interactive sessions.
- Requires implementation of reduced-CSV extraction and dedicated frozen export command flow.

## Alternatives
- Keep dual-mode field in one schema (`mode: reference-only|portable-archive`):
  - Rejected due to avoidable complexity and confusion in MVP UX.
- Embed full tuple data directly in YAML archives:
  - Rejected because paired frozen CSV + layout is simpler to diff, inspect, and reuse with existing loaders.
