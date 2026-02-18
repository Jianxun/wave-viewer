# Project Status

## Current state summary
- HDF5 single-run ingestion contract (`ADR-0020`) is merged and active.
- New AC complex-support direction is now proposed in `ADR-0021`: host-side lazy accessor projection, finite real-only runtime payloads, and structured layout signal refs.
- Task slice `T-065` to `T-067` is complete and merged.
- New X-axis `linear`/`log` capability is moving under architecture-first sequencing: `ADR-0022` is accepted and protocol/MVP spec freeze is in progress before executor implementation begins.

## Last merged/verified status
- `T-067` done (PR #84) and merged.
- Context consistency check passed after planning updates:
  - `./venv/bin/python scripts/lint_tasks_state.py`

## Next 1-3 tasks
1. `T-068` author `ADR-0022` and contract deltas for per-plot X-axis `linear`/`log` scale semantics.
2. `T-069` freeze protocol + MVP spec updates for host-authoritative X-scale updates and log-toggle validation rules.
3. `T-070` begin implementation only after T-068/T-069 are done, treating ADR/spec/contract as fixed inputs.

## Known risks / unknowns
- Log-scale range semantics are subtle: runtime needs deterministic conversion between raw-unit persisted ranges and Plotly log-axis units.
- Datasets with non-positive X values need clear, non-silent failure behavior when users request log scale.
- Rangeslider behavior in log mode must remain stable across relayout/reset/replay flows.
