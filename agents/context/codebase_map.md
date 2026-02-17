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
    - `hdf5-normalized-waveform-format.md` (draft normalized run-centric non-CSV ingestion contract)
- `doc/`
  - Architecture references:
    - `vaporview-architecture-findings.md` (side-panel/custom-editor architecture analysis)
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
- MVP implementation spec: `doc/specs/wave-viewer-mvp.md`
- Normalized HDF5 ingestion spec: `doc/specs/hdf5-normalized-waveform-format.md`
- ADR-0002 implementation spec: `doc/specs/domain-stacked-shared-x-implementation.md`

## Notes
- Current architecture source roots:
  - `src/extension.ts` (extension host commands + bridge)
  - `src/core/csv/*` (CSV parser + dataset selection)
  - `src/core/spec/*` (YAML import/export)
  - `src/webview/state/*` (workspace reducer/types)
  - `src/webview/plotly/*` (adapter/rendering)
  - `src/webview/components/*` (UI controls)
  - `src/webview/components/SignalList.ts` (lane-board chips, lane activation, new-lane drop target)
  - `src/webview/main.ts` (webview wiring, plot overlay drop lifecycle)
  - `src/webview/styles.css` (lane/chip/drop-target styling)
- Regression tests:
  - `tests/unit/*`
  - `tests/extension/*`
  - `tests/e2e/*`
