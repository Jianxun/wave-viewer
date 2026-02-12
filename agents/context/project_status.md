# Project Status

## Current state summary
- Previous execution wave (`T-025`..`T-031`) is archived due to architecture pivot.
- Architecture/spec baseline now targets host-authoritative state ownership, revisioned intent protocol, and active-axis default targeting semantics.
- Protocol migration slice (`T-032`..`T-036`) is merged; `T-037` remains deferred in icebox for replay/docs cleanup.
- UX migration slice (`T-038`..`T-040`) is complete and merged (lane-owned chips, lane activation intent, anchored new-axis insertion semantics).
- Lane drag reassignment now persists through host-authoritative state updates (no snap-back after focus changes).
- New-lane affordance now uses click-to-create (instead of drag-to-create) and is fixed at the bottom of lane board to avoid active-lane repositioning churn.
- Latest UI stabilization pass shipped: lane controls (`Up/Down/Close`) persist to host, quick-add routes to active lane again, x-axis anchors to bottom lane, and range slider is restored/tuned.
- New focus area is multi-plot correctness and persistence.

## Last merged/verified status
- PRs #30, #31, #32, #33, #34, and #35 are merged (`T-025`..`T-030`).
- `T-031` was archived as deferred during refactor pivot (no merged PR).
- Refactor PRs #39, #40, #41, #42, and #43 are merged (`T-032`..`T-036`).
- UX PRs #44, #45, and #46 are merged (`T-038`..`T-040`).
- Active task state currently has no planned sprint tasks.
- Local verification in current workspace:
  - lane activation intent is wired end-to-end (webview click -> host state patch -> explorer add targeting),
  - lane-to-lane chip drag works,
  - bottom-anchored "Click here to create a new lane" control appends lane at board bottom.
  - quick-add to active lane is restored,
  - x-axis range slider is visible, anchored to bottom lane, and drag interaction no longer redefines range unexpectedly.

## Next 1-3 tasks
1. `T-041` Make plot tab lifecycle host-authoritative (`+Plot`/select/remove persistence across focus/reopen).
2. `T-042` Ensure explorer quick-add/drop targets active plot + active lane in multi-plot sessions.
3. `T-043` Fix plot rename persistence via host intent.

## Known risks / unknowns
- Chip drag behavior must key by `trace.id` to avoid duplicate-signal collisions and unintended trace reassignment.
- Multi-plot actions still have local-vs-host drift risk until all plot lifecycle actions are intent-driven.
- PNG export/save is currently broken and tracked as `T-044` in backlog.
