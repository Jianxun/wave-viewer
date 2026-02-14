# Wave Viewer

Wave Viewer is a VS Code extension for plotting numeric signals from local CSV files in a tabbed, multi-axis Plotly workspace.

## Usage Workflow

### 1) Load Data and Open a Viewer

1. Run `Wave Viewer: Load CSV File...` from the side-panel title actions.
2. Select one or more CSV files.
3. Wave Viewer resolves `<csv>.wave-viewer.yaml` for each loaded dataset:
   - if present, it opens/binds a viewer to that layout;
   - if missing, it creates the layout from initial state and opens/binds a viewer.

You can also run `Wave Viewer: Open Viewer` directly. Commands that require a viewer auto-open one when needed.

### 2) Plot Signals (Side-Panel First)

1. In the `Wave Viewer Signals` explorer:
   - `Add to Plot` appends the selected signal to the active lane.
   - `Add to New Axis` creates a new lane, appends the signal, and activates that lane.
2. Viewer routing is host-resolved: explicit target (if set), focused eligible viewer, dataset-bound fallback, then auto-open.
3. Open additional tabs from the plot tabs bar (`+`) for alternate views.

### 3) Save/Open Layouts

1. Run `Wave Viewer: Save Layout As...` to persist the current workspace as `*.wave-viewer.yaml`.
2. Run `Wave Viewer: Open Layout (YAML)` to import a saved layout.
3. `Open Layout` works even when no viewer is focused; Wave Viewer auto-opens and binds one.

Layouts use schema `version: 2` with:
- `datasets[]`
- `active_dataset`
- dataset-qualified `x.dataset` and lane signal references (`dataset`, `signal`)

### 4) Export Frozen Bundle

Run `Wave Viewer: Export Frozen Bundle` to export immutable replay artifacts from the current session.

### 5) Reload Behavior (Manual QA)

- Run `Wave Viewer: Reload All Files` after editing a loaded CSV file.
- Expected:
  - Existing plotted traces refresh immediately without adding/dropping any new signal.
  - Reload uses one atomic replay update (`host/replaySnapshot`) per impacted viewer.
  - Incremental tuple updates (`host/tupleUpsert`) are reserved for interaction-time add/drop flows, not reload.

## Known Limits (MVP)

- Lane height and spacing are deterministic/fixed for now.
- Large-dataset performance optimizations (for example decimation) are deferred.
- Local/offline CSV workflows only (no remote connectors).

## Verification

- `npm run lint`
- `npm test`
- `npm run test:e2e`
