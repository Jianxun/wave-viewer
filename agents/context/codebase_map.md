# Codebase Map

## Directory structure
- `agents/roles/`
  - Agent role definitions (`architect.md`, `coordinator.md`, `executor.md`, `explorer.md`, `reviewer.md`).
- `agents/context/`
  - Project contract, task plans, task state, project status, and navigation docs.
- `agents/scratchpads/`
  - Per-task running notes (`T-00X.md`).
- `doc/specs/`
  - Product and architecture specs:
    - `wave-viewer-mvp.md`
    - `testing-strategy.md`
    - `domain-stacked-shared-x-implementation.md` (ADR-0002 execution guide)
- `scripts/`
  - Workflow helper scripts:
    - `lint_tasks_state.py`: validates `tasks.yaml` and `tasks_state.yaml`.
    - `dispatcher_json_stream.py`
    - `send_imessage.sh`

## Quick references
- Contract and architecture decisions: `agents/context/contract.md`
- Active tasks: `agents/context/tasks.yaml`
- Task workflow state: `agents/context/tasks_state.yaml`
- Archived tasks: `agents/context/tasks_archived.yaml`
- Global resume point: `agents/context/project_status.md`
- Active task scratchpads: `agents/scratchpads/T-008.md` to `agents/scratchpads/T-012.md`
- MVP implementation spec: `doc/specs/wave-viewer-mvp.md`
- ADR-0002 implementation spec: `doc/specs/domain-stacked-shared-x-implementation.md`

## Notes
- Current architecture source roots:
  - `src/extension.ts` (extension host commands + bridge)
  - `src/core/csv/*` (CSV parser + dataset selection)
  - `src/core/spec/*` (YAML import/export)
  - `src/webview/state/*` (workspace reducer/types)
  - `src/webview/plotly/*` (adapter/rendering)
  - `src/webview/components/*` (UI controls)
- Regression tests:
  - `tests/unit/*`
  - `tests/extension/*`
  - `tests/e2e/*`
