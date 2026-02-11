# Wave Viewer Contract

## Project overview
Wave Viewer is a Visual Studio Code extension that loads waveform-like numeric data from CSV files and renders interactive plots inside a VS Code webview. The plotting engine is Plotly.js.

The initial milestone focuses on a reliable MVP for local CSV visualization with predictable parsing, explicit signal-to-axis assignment, and deterministic replay through YAML specs.

Active ADRs:
- `ADR-0001`: Workspace uses tabs, trace-instance axis assignment, extensible `y1..yN` axis model, deterministic YAML replay.

## System boundaries / components
- VS Code extension host (TypeScript): commands, CSV loading orchestration, webview lifecycle.
- Webview UI (HTML/CSS/TypeScript): plot tabs, signal list, trace list, axis manager, Plotly canvas.
- CSV ingestion layer: parse CSV, infer plottable numeric signals, normalize dataset.
- Plot state layer: manage workspace with multiple plots/tabs and N-axis metadata.
- Plot adapter: map dataset and plot state to Plotly traces/layout.
- Spec persistence: export/import deterministic YAML workspace specs.

## Interfaces & data contracts
- Input file format:
  - `*.csv` UTF-8 text.
  - Header row required.
  - Zero or more numeric columns; at least one numeric column is required to plot.
  - `time` is optional. If present, it is the default X signal.
- Normalized in-memory structure:
  - `Dataset`:
    - `path: string`
    - `rowCount: number`
    - `columns: Array<{ name: string; values: number[] }>`
  - `WorkspaceState`:
    - `activePlotId: string`
    - `plots: PlotState[]`
  - `PlotState`:
    - `id: string`
    - `name: string`
    - `xSignal: string`
    - `axes: AxisState[]` where axis ids are `y1`, `y2`, `y3`, ...
    - `traces: TraceState[]` where each trace instance references one `axisId`
  - Same signal MAY appear in multiple trace instances across different axes.
- User entry points:
  - VS Code command to open the active CSV and launch viewer webview.
  - In-view actions to add/remove plot tabs and assign signals to axes.
  - Export and import YAML spec for deterministic replay.
- Spec reference:
  - Canonical MVP behavior is described in `doc/specs/wave-viewer-mvp.md`.

## Invariants (MUST / MUST NOT)
- MUST use Plotly as the waveform rendering engine.
- MUST reject malformed CSV with actionable error messages (no silent truncation).
- MUST keep CSV parsing and rendering concerns separated.
- MUST keep extension offline/local-only for MVP (no remote upload).
- MUST NOT block VS Code UI thread with heavy synchronous processing in webview.
- MUST preserve source CSV order for samples.
- MUST support per-tab X-signal selection.
- MUST support plotting the same signal on multiple Y-axes via independent trace instances.
- MUST provision axis identifiers as extensible (`y1..yN`) instead of hardcoding two-axis-only state.
- MUST keep exported YAML deterministic for rendered state (tab/trace/axis order and assignments).
- MUST fail clearly when importing a YAML spec that references missing signals.

## Verification protocol
- Context/schema consistency:
  - `./venv/bin/python scripts/lint_tasks_state.py`
  - Expected: `OK: tasks.yaml and tasks_state.yaml are consistent.`
- MVP testing policy:
  - `agents/context/testing_policy.md`
  - Detailed strategy in `doc/specs/testing-strategy.md`
- Pre-implementation baseline checks (once project scaffold exists):
  - `npm run lint` (extension + webview packages)
  - `npm test` (unit tests + parser contract tests)
  - `npm run test:e2e` (if configured, smoke open+plot flow)

## Decision log
- 2026-02-11: Plotly selected as mandatory plotting engine for waveform rendering due to mature interaction tooling and rapid webview integration.
- 2026-02-11: MVP scope constrained to local CSV ingestion and in-editor visualization only; remote data connectors deferred.
- 2026-02-11: CSV contract changed to optional `time`; default X is `time` when present, otherwise first numeric column.
- 2026-02-11: Multi-plot workspace uses tabs (not tiled layout) for MVP to keep state and deterministic replay simpler.
- 2026-02-11: Signal-to-axis assignment uses trace instances so one signal can be plotted on multiple axes.
- 2026-02-11: Axis model is provisioned for `y1..yN` now, while MVP UI can expose a smaller subset initially.
