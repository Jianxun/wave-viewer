# ADR-0013: Layout Schema v2 Human-Editable Contract (MVP Only)

## Status
Accepted

## Context
The existing layout YAML schema is structurally optimized for machine stability but is brittle for human editing. Pain points include strict `yN` axis identifiers in file structure, split axis/trace blocks that are tedious to reorganize manually, and redundant schema fields (`mode`) for current MVP workflows.

MVP now prioritizes fast manual iteration on layouts. This requires a cleaner schema with explicit per-plot X settings and lane-grouped signal declarations while preserving deterministic host/runtime behavior.

## Decision
- Adopt a single supported layout schema for MVP: `version: 2`.
- Remove `mode` from layout schema.
- Define layout structure as:
  - `dataset.path`
  - `active_plot`
  - `plots[]` with per-plot `x` config (`signal`, optional `label`, optional `range`)
  - `plots[].y[]` lanes with required user-facing `id`, optional lane metadata (`label`, `scale`, `range`), and `signals` map (`label -> dataset signal`)
- Do not support backward compatibility import for `version: 1` during MVP refactor.
- Keep internal runtime/Plotly axis IDs canonical (`y1..yN`) by mapping lane order to internal axes at import time.
- Treat trace visibility as runtime-only state; layout import defaults `visible: true`.

## Consequences
- Layout files become significantly easier to edit by hand (group/move signals by lane).
- This is a breaking change: existing v1 layouts must be regenerated or manually rewritten.
- Host/spec layer needs explicit import/export mapping between user-facing lane IDs and internal axis IDs.

## Alternatives
- Keep v1 schema and incrementally relax axis ID validation:
  - Rejected because it preserves brittle editing ergonomics and mixed legacy structure.
- Support v1 and v2 simultaneously in MVP:
  - Rejected to keep the refactor clean and avoid split-path maintenance during rapid iteration.
