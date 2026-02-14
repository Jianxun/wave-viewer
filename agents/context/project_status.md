# Project Status

## Current state summary
- Multi-dataset v2 layout/routing/frozen-export slice (`T-054` to `T-059`) is merged and archived.
- Packaged extension usability issues were triaged in-session; a remaining defect is reload consistency: existing plotted traces can stay stale after `Reload All Files` until a new user intent is sent.
- `ADR-0018` is accepted (2026-02-14): reload flows must use atomic host replay snapshots (`workspace + viewerState + tuples`) instead of incremental tuple-only reload sync.
- Protocol/spec docs were updated to encode replay-snapshot requirements for dataset reload behavior.

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
  - `./venv/bin/python scripts/lint_tasks_state.py` pending rerun after architecture file updates.

## Next 1-3 tasks
1. `T-060` implement `host/replaySnapshot` protocol and atomic webview apply path.
2. `T-061` replace reload incremental tuple fanout with viewer-scoped replay snapshot generation.
3. `T-062` add regression tests that prove reload refreshes existing traces without requiring new add/drop intents.

## Known risks / unknowns
- Replay snapshot payload size can increase on large workspaces; correctness is prioritized for MVP and payload optimization may be needed later.
- Reload path touches protocol, extension orchestration, and webview render state together; partial rollouts will reintroduce stale-cache behavior.
- Path normalization across imported/frozen layouts remains a risk area; tests must include relative and rewritten dataset path scenarios.
