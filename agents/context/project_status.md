# Project Status

## Current state summary
- Multi-dataset v2 layout/routing/frozen-export slice (`T-054` to `T-059`) is merged and archived.
- Packaged extension usability issues were triaged in-session; a remaining defect is reload consistency: existing plotted traces can stay stale after `Reload All Files` until a new user intent is sent.
- `ADR-0018` is accepted (2026-02-14): reload flows must use atomic host replay snapshots (`workspace + viewerState + tuples`) instead of incremental tuple-only reload sync.
- Protocol/spec docs were updated to encode replay-snapshot requirements for dataset reload behavior.
- `ADR-0019` is proposed (2026-02-17): define run-centric normalized HDF5 waveform ingestion to decouple simulator raw quirks from viewer code.

## Last merged/verified status
- Task states:
  - `T-054` done (PR #64),
  - `T-055` done (PR #65),
  - `T-056` done (PR #66),
  - `T-057` done (PR #67),
  - `T-058` done (PR #68),
  - `T-059` done (PR #69).
- New sprint slice created and ready:
  - `T-060` protocol/webview replay snapshot support,
  - `T-061` host reload replay fanout rewrite,
  - `T-062` regression coverage for reload-without-new-intent,
  - `T-063` cleanup + docs alignment.
- Local verification for current workspace changes:
  - `./venv/bin/python scripts/lint_tasks_state.py` passed after architecture file updates.

## Next 1-3 tasks
1. `T-064` implement normalized HDF5 loader and map selected run into existing `Dataset` contract.
2. Add HDF5 parser-focused unit tests for required metadata/groups and deterministic `<file>#<run_id>` identity.
3. Define initial UX for selecting non-default runs in multi-run files (follow-up task after `T-064`).

## Known risks / unknowns
- Replay snapshot payload size can increase on large workspaces; correctness is prioritized for MVP and payload optimization may be needed later.
- Reload path touches protocol, extension orchestration, and webview render state together; partial rollouts will reintroduce stale-cache behavior.
- Path normalization across imported/frozen layouts remains a risk area; tests must include relative and rewritten dataset path scenarios.
