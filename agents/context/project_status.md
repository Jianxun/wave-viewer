# Project Status

## Current state summary
- Layout schema is now v2-only (`version: 2`) with host-side translation and lane-id mapping (`T-050`, `T-051` merged).
- Frozen bundle export workflow is merged and stable (`T-052`): exports `<name>.frozen.csv` + `<name>.frozen.wave-viewer.yaml`.
- Test/docs baseline refresh for v2-only flow is merged (`T-053`).
- Architecture direction was updated on 2026-02-13:
  - `ADR-0015` accepted: patch `version: 2` schema directly to multi-dataset (`datasets[]`, dataset-qualified x/y bindings).
  - `ADR-0016` accepted: keep a single explorer with multi-viewer host routing and auto-open viewer semantics for viewer-dependent commands.
  - `ADR-0017` accepted: frozen export for multi-dataset layouts is one frozen layout plus one frozen CSV per referenced dataset.
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
  - `T-054` ready (no PR yet),
  - `T-055` ready (no PR yet),
  - `T-056` ready (no PR yet),
  - `T-057` ready (no PR yet),
  - `T-058` ready (no PR yet),
  - `T-059` ready (no PR yet).
- Local verification for current workspace changes:
  - `npm run lint` passed,
  - `npm test -- tests/extension/smoke.test.ts` passed,
  - `npm test -- tests/unit/webview/workspaceState.test.ts` passed.

## Next 1-3 tasks
1. `T-055` Redefine core spec import/export for multi-dataset `version: 2` layout semantics (breaking by design).
2. `T-056` Refactor host routing/session model to support single explorer + multiple live viewers with deterministic targeting.
3. `T-057` and `T-059` unify command flows + frozen bundle outputs around multi-dataset v2 semantics.

## Known risks / unknowns
- Breaking schema patch to v2 will invalidate existing single-dataset v2 files; this is intentional but should be called out in release notes/tests.
- Session routing complexity rises with multi-viewer auto-open behavior; tests must cover ambiguous targeting and no-active-viewer paths.
- Autosave/external-watch ordering around default-layout creation and immediate viewer open can cause duplicate reloads if self-write suppression is incomplete.
