# Project Status

## Current state summary
- Previous execution wave (`T-025`..`T-031`) is archived due to architecture pivot.
- Architecture/spec baseline now targets host-authoritative state ownership, revisioned intent protocol, and active-axis default targeting semantics.
- Protocol migration slice (`T-032`..`T-036`) is merged; `T-037` remains the final migration cleanup task.
- UX slice (`T-038`..`T-040`) is in active iteration for lane-owned signal chips and active-lane targeting.
- Latest manual verification: lane-board click now updates active lane used by Explorer `Add Signal to Plot`, and "Drop signal here to create a new lane" is functioning again.
- Remaining work is UI refinement/polish and interaction cleanup, to continue in the next session.

## Last merged/verified status
- PRs #30, #31, #32, #33, #34, and #35 are merged (`T-025`..`T-030`).
- `T-031` was archived as deferred during refactor pivot (no merged PR).
- Refactor PRs #39, #40, #41, #42, and #43 are merged (`T-032`..`T-036`).
- Active task state now tracks `T-037` and the new UX slice `T-038`..`T-040`.
- Local verification in current workspace:
  - lane activation intent is wired end-to-end (webview click -> host state patch -> explorer add targeting),
  - lane-to-lane chip drag works,
  - new-lane drop target is operational.

## Next 1-3 tasks
1. T-038: replace split sidebar lists with lane-aligned draggable trace-chip board.
2. T-039: add explicit lane activation intent from lane-container click.
3. T-040: insert "drop to new lane" target immediately below active lane with axis insertion semantics.

## Known risks / unknowns
- Chip drag behavior must key by `trace.id` to avoid duplicate-signal collisions and unintended trace reassignment.
- Sidebar simplification still has UX debt (visual density, control discoverability, and consistency with waveform viewer mental model).
- Must preserve parity for quick-add and side-panel add flows while reducing controls.
