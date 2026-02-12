# Project Status

## Current state summary
- Side-panel-first workflow wave is implemented and merged (`T-013`, `T-014`, `T-018`, `T-015`, `T-016`, `T-017`, `T-019`).
- Specs/ADRs were realigned to side-panel workflow + versioned host/webview protocol and custom-editor defer policy.
- Completed side-panel workflow tasks (`T-013`..`T-019`) are archived in `agents/context/tasks_archived.yaml`.
- Completed Explorer loaded-file hardening tasks (`T-020`..`T-024`) are now archived.
- Product direction for next slice is session-based viewer routing plus deterministic default-X policy alignment (`first column`, no `time` special-case).

## Last merged/verified status
- PRs #16, #17, #18, #19, #20, #21, and #22 are merged.
- Latest architecture/spec/task realignment PR (#15) is also merged.
- PRs #24, #25, #26, #27, and #28 are merged (`T-020`..`T-024` complete).
- Active task state now tracks `T-025..T-030` for the next execution slice.
- Context consistency check passes: `./venv/bin/python scripts/lint_tasks_state.py`.

## Next 1-3 tasks
1. T-025: restore Explorer signal actions for standalone viewer launch.
2. T-026: introduce viewer-session registry in extension host.
3. T-027: add explicit viewer-binding protocol messages.

## Known risks / unknowns
- Side-panel command routing is currently vulnerable when viewer launch is dataset-agnostic; needs explicit viewer-session targeting.
- Protocol expansion for session binding must keep runtime validation strict and reducer-level semantics unchanged.
- Default-X implementation/tests still need to be aligned to the updated first-column contract.
