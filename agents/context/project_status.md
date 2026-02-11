# Project Status

## Current state summary
- Baseline MVP (`T-001..T-007`) and ADR-0002 lane migration (`T-008..T-012`) are complete and archived.
- Plot canvas visual/interaction refinements were applied after `T-012`:
  - dark Plotly canvas theme
  - drag zoom parity with legacy yaml2plot behavior
  - rangeslider bounds clipping to X-data min/max
  - lane/domain outline rendering
- VaporView architecture reference was reviewed and documented in `doc/vaporview-architecture-findings.md`.
- Active execution queue is now `T-013..T-016` for side-panel-first signal workflows.

## Last merged/verified status
- PRs #1 through #13 merged for MVP + ADR-0002 lane model tasks.
- Task archive updated for `T-008..T-012` on 2026-02-11.
- New architecture/task slicing prepared for side-panel and drag/drop ergonomics.
- Verification to run after slicing edits: `./venv/bin/python scripts/lint_tasks_state.py`.

## Next 1-3 tasks
1. T-013: add side-panel signal browser and extension-webview signal actions.
2. T-014: implement drag and drop from side-panel signals to axis lanes.
3. T-015: add canvas-domain drop overlay and quick-add ergonomics.

## Known risks / unknowns
- Side-panel and webview action routing can drift if command/message contracts are not centralized.
- Drag/drop targeting must remain deterministic across row targets and canvas-domain targets.
- Large dataset performance remains unbenchmarked for multi-trace side-panel workflows.
