# Wave Viewer Contract

## Project overview
Wave Viewer is a Visual Studio Code extension that loads waveform-like numeric data from CSV files and renders interactive plots inside a VS Code webview. The plotting engine is Plotly.js.

The MVP focuses on reliable local CSV visualization with deterministic replay through YAML specs, while moving to a side-panel-first signal workflow without breaking existing reducer-driven state guarantees.

Active ADRs:
- `ADR-0001`: Workspace uses tabs, trace-instance axis assignment, extensible `y1..yN` axis model, deterministic YAML replay.
- `ADR-0002`: Per-plot rendering uses one shared `xaxis` + rangeslider and non-overlapping `yaxis*` domains (not synced multi-canvas subplots).
- `ADR-0003`: Side-panel-first signal workflow with transitional in-webview fallback during migration.
- `ADR-0004`: Host-webview protocol is explicitly typed, versioned, and runtime-validated.
- `ADR-0005`: MVP keeps command-opened webview surface; custom editor migration is deferred until side-panel workflow stabilization.

## System boundaries / components
- VS Code extension host (TypeScript): commands, CSV loading orchestration, webview lifecycle, side-panel view, protocol validation.
- VS Code side-panel signal browser view: discover/select signals and invoke plot actions.
- Webview UI (HTML/CSS/TypeScript): plot tabs, trace list, axis manager, Plotly canvas, lane drop targets.
- CSV ingestion layer: parse CSV, infer plottable numeric signals, normalize dataset.
- Plot state layer: manage workspace with multiple plots/tabs and N-axis metadata.
- Plot adapter: map dataset and plot state to one shared-`xaxis` figure with domain-stacked `yaxis*` lanes.
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
- Host/webview protocol:
  - Envelope requires `{ version, type, payload }`.
  - `webview/dropSignal` is the normalized drop event contract for lane-targeted signal add flows.
  - Protocol rules are defined in `doc/specs/host-webview-protocol.md`.
- User entry points:
  - VS Code command to open the active CSV and launch viewer webview.
  - Side-panel signal actions (add/reveal/new-axis) as primary signal workflow.
  - Webview plotting controls and lane drop targets.
  - Export and import YAML spec for deterministic replay.
- Spec references:
  - `doc/specs/wave-viewer-mvp.md`
  - `doc/specs/domain-stacked-shared-x-implementation.md`
  - `doc/specs/side-panel-workflow.md`
  - `doc/specs/host-webview-protocol.md`
  - `doc/vaporview-architecture-findings.md` (reference implementation guidance; non-normative)

## Invariants (MUST / MUST NOT)
- MUST use Plotly as waveform rendering engine.
- MUST reject malformed CSV with actionable error messages (no silent truncation).
- MUST keep CSV parsing and rendering concerns separated.
- MUST keep extension offline/local-only for MVP (no remote upload).
- MUST preserve source CSV order for samples.
- MUST support per-tab X-signal selection.
- MUST support plotting the same signal on multiple Y-axes via independent trace instances.
- MUST provision axis identifiers as extensible (`y1..yN`) instead of hardcoding two-axis-only state.
- MUST use one shared `xaxis` per plot tab with one rangeslider.
- MUST render multiple Y axes in non-overlapping vertical domains (stacked lanes) within one figure.
- MUST NOT rely on multi-canvas or cross-subplot sync mechanisms for shared X behavior.
- MUST keep side-panel as primary signal discovery/action surface during migration and beyond.
- MUST keep side-panel command path, drag/drop path, and fallback in-webview path semantically equivalent at reducer level.
- MUST enforce protocol envelope and runtime payload validation at host/webview boundaries.
- MUST keep exported YAML deterministic for rendered state (tab/trace/axis order and assignments).
- MUST fail clearly when importing a YAML spec that references missing signals.

## Verification protocol
- Context/schema consistency:
  - `./venv/bin/python scripts/lint_tasks_state.py`
  - Expected: `OK: tasks.yaml and tasks_state.yaml are consistent.`
- MVP testing policy:
  - `doc/specs/testing-strategy.md`
- Baseline checks:
  - `npm run lint`
  - `npm test`
- Workflow/protocol focus checks (when applicable):
  - `npm test -- tests/extension/smoke.test.ts`
  - `npm test -- tests/unit/webview/workspaceState.test.ts tests/unit/webview/plotly/adapter.test.ts`

## Decision log
- 2026-02-11: Plotly selected as mandatory plotting engine for waveform rendering due to mature interaction tooling and rapid webview integration.
- 2026-02-11: MVP scope constrained to local CSV ingestion and in-editor visualization only; remote data connectors deferred.
- 2026-02-11: CSV contract changed to optional `time`; default X is `time` when present, otherwise first numeric column.
- 2026-02-11: Multi-plot workspace uses tabs (not tiled layout) for MVP to keep state and deterministic replay simpler.
- 2026-02-11: Signal-to-axis assignment uses trace instances so one signal can be plotted on multiple axes.
- 2026-02-11: Axis model is provisioned for `y1..yN` now, while MVP UI can expose a smaller subset initially.
- 2026-02-11: Adopted domain-stacked Y-axis rendering in a single figure with shared X-axis/rangeslider (no subplot sync model); see ADR-0002.
- 2026-02-11: Adopted side-panel-first signal workflow with transitional fallback policy; see ADR-0003.
- 2026-02-11: Adopted explicit versioned host-webview protocol contract and runtime validation requirement; see ADR-0004.
- 2026-02-11: Deferred custom-editor migration until side-panel-first refactor stabilization criteria are met; see ADR-0005.
