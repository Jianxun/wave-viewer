# Codebase Map

## Directory structure
- `agents/roles/`
  - Agent role definitions (`architect.md`, `coordinator.md`, `executor.md`, `explorer.md`, `reviewer.md`).
- `agents/context/`
  - Project contract, task plans, task state, project status, and navigation docs.
- `agents/scratchpads/`
  - Per-task running notes (`T-00X.md`).
- `doc/specs/`
  - Product and architecture specs. Current MVP spec: `wave-viewer-mvp.md`.
- `scripts/`
  - Workflow helper scripts:
    - `lint_tasks_state.py`: validates `tasks.yaml` and `tasks_state.yaml`.
    - `dispatcher_json_stream.py`
    - `send_imessage.sh`

## Quick references
- Contract and architecture decisions: `agents/context/contract.md`
- Active tasks: `agents/context/tasks.yaml`
- Task workflow state: `agents/context/tasks_state.yaml`
- Global resume point: `agents/context/project_status.md`
- Active task scratchpad: `agents/scratchpads/T-001.md`
- MVP implementation spec: `doc/specs/wave-viewer-mvp.md`

## Notes
- Application source for the VS Code extension has not been scaffolded yet.
- First implementation tasks should add this expected structure once created:
  - `src/extension.ts` (extension host entry)
  - `src/webview/*` (webview assets and Plotly integration)
  - `test/*` (unit/integration tests)
