# Project Status

## Current state summary
- Previous execution wave (`T-025`..`T-031`) is archived due to architecture pivot.
- Architecture/spec baseline now targets host-authoritative state ownership, revisioned intent protocol, and active-axis default targeting semantics.
- Protocol migration slice (`T-032`..`T-036`) is merged; `T-037` remains the final migration cleanup task.
- Next UX slice (`T-038`..`T-040`) is defined to simplify sidebar interactions around lane-owned signal chips and active-lane targeting.

## Last merged/verified status
- PRs #30, #31, #32, #33, #34, and #35 are merged (`T-025`..`T-030`).
- `T-031` was archived as deferred during refactor pivot (no merged PR).
- Refactor PRs #39, #40, #41, #42, and #43 are merged (`T-032`..`T-036`).
- Active task state now tracks `T-037` and the new UX slice `T-038`..`T-040`.

## Next 1-3 tasks
1. T-038: replace split sidebar lists with lane-aligned draggable trace-chip board.
2. T-039: add explicit lane activation intent from lane-container click.
3. T-040: insert "drop to new lane" target immediately below active lane with axis insertion semantics.

## Known risks / unknowns
- Chip drag behavior must key by `trace.id` to avoid duplicate-signal collisions and unintended trace reassignment.
- Axis insertion ordering for "new lane below active" may require reducer/API shape changes that can ripple into host drop-intent handling.
- Sidebar simplification must preserve parity for existing quick-add and side-panel add flows.
