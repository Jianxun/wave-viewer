# Project Status

## Current state summary
- Baseline MVP (`T-001..T-007`) has been completed and archived.
- Architecture decision pivot accepted in `ADR-0002`:
  - per-tab rendering uses one shared `xaxis` + rangeslider
  - `yaxis*` are stacked by non-overlapping domains (lane model)
  - no multi-canvas subplot synchronization model
- Execution guide added at `doc/specs/domain-stacked-shared-x-implementation.md`.
- Active execution queue is now `T-008..T-012`.

## Last merged/verified status
- PRs #1 through #7 merged for baseline MVP tasks.
- Task archives and new slicing updated on 2026-02-11.
- Verification to run after slicing edits: `./venv/bin/python scripts/lint_tasks_state.py`.

## Next 1-3 tasks
1. T-008: rebaseline state model for lane ordering and ADR-0002 semantics.
2. T-009: implement Plotly domain-stacked lane rendering with shared rangeslider.
3. T-010: align axis manager UI with lane-order behavior.

## Known risks / unknowns
- Legacy spec compatibility behavior must be explicit (`T-011`).
- Lane layout readability with high axis counts (>8) needs future tuning.
- Large dataset performance remains unbenchmarked under lane rendering.
