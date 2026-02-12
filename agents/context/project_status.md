# Project Status

## Current state summary
- Previous execution wave (`T-025`..`T-031`) is archived due to architecture pivot.
- Architecture/spec baseline now targets host-authoritative state ownership, revisioned intent protocol, and active-axis default targeting semantics.
- New refactor slice (`T-032`..`T-037`) is defined to migrate from dual-writer flow to host-authoritative flow without behavior regressions.

## Last merged/verified status
- PRs #30, #31, #32, #33, #34, and #35 are merged (`T-025`..`T-030`).
- `T-031` was archived as deferred during refactor pivot (no merged PR).
- Active task state now tracks `T-032`..`T-037` only.

## Next 1-3 tasks
1. T-032: introduce host-authoritative workspace + viewer interaction store.
2. T-033: implement revisioned intent protocol v2 between webview and host.
3. T-034: convert webview to projection-only renderer and intent emitter.

## Known risks / unknowns
- Migration requires careful sequencing to avoid breaking existing side-panel and drag/drop behavior during protocol cutover.
- Removing dual-write paths may expose hidden coupling in tests and smoke fixtures.
- Active-axis lifecycle needs deterministic fallback behavior for axis delete/reassign edge cases.
