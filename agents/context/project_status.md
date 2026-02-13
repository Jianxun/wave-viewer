# Project Status

## Current state summary
- Layout schema is now v2-only (`version: 2`) with host-side translation and lane-id mapping (`T-050`, `T-051` merged).
- Frozen bundle export workflow is merged and stable (`T-052`): exports `<name>.frozen.csv` + `<name>.frozen.wave-viewer.yaml`.
- Test/docs baseline refresh for v2-only flow is merged (`T-053`).
- Recent UX refinements landed:
  - axis title inference on first trace add (`V*` -> `Voltage (V)`, `I*` -> `Current (A)`, case-insensitive),
  - inferred title applies once per axis and preserves manual edits.
- Command surface has been simplified:
  - removed `saveLayout`, `exportPlotSpec`, `importPlotSpec`, and `signalBrowser.revealInPlot`,
  - retained `openViewer`, `openLayout`, `saveLayoutAs`, `exportFrozenBundle`, and core signal-browser actions.

## Last merged/verified status
- Task states:
  - `T-050` done (PR #59),
  - `T-051` done (PR #60),
  - `T-052` done (PR #61),
  - `T-053` done (PR #62),
  - `T-054` ready (no PR yet).
- Local verification for current workspace changes:
  - `npm run lint` passed,
  - `npm test -- tests/extension/smoke.test.ts` passed,
  - `npm test -- tests/unit/webview/workspaceState.test.ts` passed.

## Next 1-3 tasks
1. `T-054` Implement destructive reset actions:
   - `waveViewer.clearLayout` (palette command with confirmation),
   - in-viewer `Clear Plot` control for active plot with confirmation.
2. Validate host-transaction + autosave behavior for both reset flows under layout external-reload watchers.
3. Revisit command discoverability for any additional palette entries after `T-054` UX lands.

## Known risks / unknowns
- `clearLayout` is intentionally destructive; confirmation UX and wording must prevent accidental data loss.
- `clearPlot` placement in viewer chrome is still open; poor placement could blur plot-local vs layout-global semantics.
- Autosave timing edge cases around destructive actions should be validated to avoid stale external-edit reload artifacts.
