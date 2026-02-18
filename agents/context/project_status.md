# Project Status

## Current state summary
- HDF5 single-run ingestion contract (`ADR-0020`) is merged and active.
- New AC complex-support direction is now proposed in `ADR-0021`: host-side lazy accessor projection, finite real-only runtime payloads, and structured layout signal refs.
- Task slice `T-065` to `T-067` is complete and merged.
- Architect pre-work for X-axis `linear`/`log` is complete: `ADR-0022` is accepted and protocol/MVP specs are frozen before executor implementation begins.

## Last merged/verified status
- `T-068` and `T-069` done via PR #85 (ADR/spec/contract freeze complete).
- Context consistency check passed after planning updates:
  - `./venv/bin/python scripts/lint_tasks_state.py`

## Next 1-3 tasks
1. `T-070` implement host protocol and reducer support for plot X-axis scale updates.
2. `T-071` implement webview X-scale UI and log-aware Plotly range conversions.
3. `T-072` add end-to-end regression coverage for X-axis log workflows.

## Known risks / unknowns
- Log-scale range semantics are subtle: runtime needs deterministic conversion between raw-unit persisted ranges and Plotly log-axis units.
- Datasets with non-positive X values need clear, non-silent failure behavior when users request log scale.
- Rangeslider behavior in log mode must remain stable across relayout/reset/replay flows.
