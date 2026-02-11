# Project Status

## Current state summary
- Project context scaffolding initialized for the Wave Viewer VS Code extension.
- Core contract updated for:
  - CSV parsing without mandatory `time`.
  - multi-plot tabs with per-tab X-signal.
  - trace-instance model allowing one signal on multiple Y-axes.
  - N-axis provisioning (`y1..yN`) with deterministic YAML replay goals.
- MVP spec captured in `doc/specs/wave-viewer-mvp.md`.
- `T-001` discussion outcomes captured and implementation tasks sliced.

## Last merged/verified status
- No application code merged yet.
- Context and planning files updated on 2026-02-11.
- Pending verification: run `./venv/bin/python scripts/lint_tasks_state.py` after task slicing edits.

## Next 1-3 tasks
1. T-002: scaffold extension command, split-pane webview shell, and host/webview bridge.
2. T-003: implement CSV ingestion, dataset normalization, and default X-signal selection.
3. T-004: implement tabbed workspace state with N-axis and trace-instance assignment.

## Known risks / unknowns
- CSV schema variations (delimiter, quoted values, missing cells) can expand parser complexity if parsing scope is widened too early.
- Large dataset performance limits in webview are unknown until benchmarked.
- Axis crowding/readability for `y3+` needs pragmatic defaults in Plotly adapter.
