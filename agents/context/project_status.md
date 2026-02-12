# Project Status

## Current state summary
- Previous execution wave (`T-025`..`T-031`) is archived due to architecture pivot.
- Architecture/spec baseline now targets host-authoritative state ownership, revisioned intent protocol, and active-axis default targeting semantics.
- Protocol migration slice (`T-032`..`T-036`) is merged; `T-037` remains deferred in icebox for replay/docs cleanup.
- UX migration slice (`T-038`..`T-040`) is complete and merged (lane-owned chips, lane activation intent, active-lane new-axis drop target).
- Lane drag reassignment now persists through host-authoritative state updates (no snap-back after focus changes).
- The previously drafted UI polish task slice (`T-041`..`T-043`) is removed from planning.

## Last merged/verified status
- PRs #30, #31, #32, #33, #34, and #35 are merged (`T-025`..`T-030`).
- `T-031` was archived as deferred during refactor pivot (no merged PR).
- Refactor PRs #39, #40, #41, #42, and #43 are merged (`T-032`..`T-036`).
- UX PRs #44, #45, and #46 are merged (`T-038`..`T-040`).
- Active task state currently has no planned sprint tasks.
- Local verification in current workspace:
  - lane activation intent is wired end-to-end (webview click -> host state patch -> explorer add targeting),
  - lane-to-lane chip drag works,
  - new-lane drop target is operational.

## Next 1-3 tasks
1. Re-scope the next UI slice before adding new sprint tasks.

## Known risks / unknowns
- Chip drag behavior must key by `trace.id` to avoid duplicate-signal collisions and unintended trace reassignment.
- Sidebar simplification still has UX debt (visual density, control discoverability, and consistency with waveform viewer mental model).
- Must preserve parity for quick-add and side-panel add flows while reducing controls.
