# Project Status

## Current state summary
- Side-panel-first workflow wave is implemented and merged (`T-013`, `T-014`, `T-018`, `T-015`, `T-016`, `T-017`, `T-019`).
- Specs/ADRs were realigned to side-panel workflow + versioned host/webview protocol and custom-editor defer policy.
- Completed side-panel workflow tasks (`T-013`..`T-019`) are archived in `agents/context/tasks_archived.yaml`.
- Product direction for next slice is single-session UX hardening: explicit loaded CSV management in Explorer (instead of active-editor-derived signal listing).

## Last merged/verified status
- PRs #16, #17, #18, #19, #20, #21, and #22 are merged.
- Latest architecture/spec/task realignment PR (#15) is also merged.
- Active task state tracks only upcoming `T-020..T-024` as `ready` after archiving completed work.
- Context consistency check passes: `./venv/bin/python scripts/lint_tasks_state.py`.

## Next 1-3 tasks
1. T-020: persist a single-session loaded CSV registry for the Explorer signal browser (no focus-based clearing).
2. T-021: add Explorer context-menu commands `Load CSV File...` and `Reload All Files`.
3. T-022: add Explorer context-menu command `Remove Loaded File` with stable side-panel behavior.

## Known risks / unknowns
- Current canvas drop overlay likely intercepts Plotly interactions (legend click/hover cursor) when not dragging; tracked as `T-023`.
- Shared x-axis ticks are currently coupled to lane ordering (`y1` anchoring), which causes unstable tick placement when lanes reorder; tracked as `T-024`.
- Transition from single-dataset assumptions to loaded-file registry must preserve deterministic side-panel action routing.
- Removing a loaded file while related viewer state exists needs explicit user-facing behavior to avoid ambiguous side effects.
