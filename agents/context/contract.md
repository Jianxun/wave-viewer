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
- `ADR-0006`: Host sends explicit `(x, y)` trace tuples using inline arrays for MVP; viewer does not infer default X from dataset columns.
- `ADR-0008`: Cross-dataset trace mixing on axes/lanes is allowed in MVP; user owns semantic consistency.
- `ADR-0009` (Proposed): Host-authoritative workspace and viewer interaction state (single writer).
- `ADR-0010` (Proposed): Revisioned intent-based host/webview protocol.
- `ADR-0011` (Proposed): Active-axis default targeting and post-new-axis activation rules.
- `ADR-0012`: Explicit layout artifact (`*.wave-viewer.yaml`) is primary persistence identity; YAML IO is host-managed with sidecar fallback.
- `ADR-0013`: Layout YAML schema is `version: 2` only in MVP, with human-editable plot/lane structure and no `mode` field.
- `ADR-0014`: Frozen export separates export artifacts from interactive layout persistence (superseded for artifact cardinality by ADR-0017).
- `ADR-0015`: Layout YAML `version: 2` is multi-dataset-first (`datasets[]`, dataset-qualified x/y signals) with no backward compatibility path.
- `ADR-0016`: Single explorer drives multiple live viewers through host-side deterministic routing and viewer auto-open semantics.
- `ADR-0017`: Frozen export for multi-dataset workspaces emits one layout YAML plus one frozen CSV per dataset.
- `ADR-0018`: Dataset reload uses atomic host replay snapshots so workspace/viewerState/tuples update coherently.
- `ADR-0019` (Proposed): Non-CSV waveform ingestion should use a normalized run-centric HDF5 contract with canonical vectors and hierarchical VDS aliases.
- `ADR-0020`: HDF5 ingestion uses a strict single-run schema (`/vectors`, `/vector_names`, `/indep_var`, `/signals`) and side-panel renders hierarchical signal tree labels while preserving canonical signal ids.

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
  - `*.csv` UTF-8 text (current production path).
  - Header row required.
  - Zero or more numeric columns; at least one numeric column is required to plot.
  - Default X signal is the first dataset column (source CSV header order), with no special-case signal-name heuristic.
  - `*.h5` / `*.spice.h5` single-run waveform container (see ADR-0020 + spec below).
    - Required layout: `/vectors`, `/vector_names`, `/indep_var/<indep_var_name>`, `/signals`.
    - Required attrs: `num_points`, `num_variables`, `indep_var_name`, `indep_var_index`.
    - Canonical numeric payload is root `vectors` + `vector_names`; `indep_var` and `signals` may be VDS aliases.
    - Full contract: `doc/specs/hdf5-normalized-waveform-format.md`.
- Normalized in-memory structure:
  - `Dataset`:
    - `path: string`
    - `rowCount: number`
    - `columns: Array<{ name: string; values: number[] }>`
  - `WorkspaceState`:
    - `datasets: Array<{ id: string; path: string }>`
    - `activeDatasetId: string`
    - `activePlotId: string`
    - `plots: PlotState[]`
  - `PlotState`:
    - `id: string`
    - `name: string`
    - `x: { datasetId: string; signal: string }`
    - `axes: AxisState[]` where axis ids are `y1`, `y2`, `y3`, ...
    - `traces: TraceState[]` where each trace instance references one `axisId` and source `datasetId`
  - Same signal MAY appear in multiple trace instances across different axes.
- Layout YAML contract (MVP):
  - Only `version: 2` is supported for import/export.
  - `mode` field is not part of the schema.
  - Layout uses:
    - `datasets[]` (`id`, `path`)
    - `active_dataset`
    - `active_plot`
    - `plots[]` with per-plot `x.dataset`, `x.signal`, optional `x.label`, optional `x.range`
    - `plots[].y[]` lanes with required user-facing `id`, optional `label`/`scale`/`range`, and `signals` map (`label -> {dataset, signal}`)
  - Layout does not persist trace visibility; import defaults all traces to `visible: true`.
  - Friendly lane IDs are mapped to internal canonical axis IDs (`y1..yN`) by per-plot lane order.
  - Importing non-v2 schema must fail with actionable errors.
- Host/webview protocol:
  - Envelope requires `{ version, type, payload }`.
  - Webview emits intent messages only; host emits authoritative revisioned state.
  - `webview/intent/dropSignal` is the normalized drop event contract for lane-targeted signal add flows.
  - Host state messages include monotonic `revision` and webview must ignore stale revisions.
  - Protocol rules are defined in `doc/specs/host-webview-protocol.md`.
- User entry points:
  - VS Code command to open Wave Viewer webview (standalone launch allowed even without active CSV editor).
  - Side-panel signal actions (`Add to Plot`, `Add to New Axis`) as primary signal workflow.
  - Webview plotting controls and lane drop targets.
  - Layout commands for deterministic replay (`Open Layout (YAML)`, `Save Layout As...`) plus frozen bundle export.
- Spec references:
  - `doc/specs/wave-viewer-mvp.md`
  - `doc/specs/domain-stacked-shared-x-implementation.md`
  - `doc/specs/side-panel-workflow.md`
  - `doc/specs/host-webview-protocol.md`
  - `doc/specs/hdf5-normalized-waveform-format.md`
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
- MUST support one explorer controlling multiple live viewer sessions.
- MUST keep side-panel command path, drag/drop path, and fallback in-webview path semantically equivalent at reducer level.
- MUST enforce protocol envelope and runtime payload validation at host/webview boundaries.
- MUST keep host as the single writer for workspace and viewer interaction state.
- MUST NOT allow webview to overwrite authoritative workspace snapshots.
- MUST keep trace identity dataset-qualified so same signal names from different datasets remain distinct.
- MUST treat dataset reload replay as an atomic host-to-webview snapshot update that includes coherent workspace, viewer state, and trace tuples.
- MUST treat "add signal to new axis" as one atomic transaction that creates axis, appends trace, and activates the new axis.
- MUST use active axis as default target for side-panel `Add to Plot` and explorer quick-add operations.
- MUST auto-open a viewer for commands that require one when no eligible viewer exists.
- MUST allow `Open Layout` to run without a pre-focused viewer by creating and binding a viewer session.
- MUST register layout-referenced datasets into explorer loaded-dataset state on open/import.
- MUST keep exported YAML deterministic for rendered state (tab/trace/axis order and assignments).
- MUST fail clearly when importing a YAML spec that references missing datasets or signals.
- MUST treat MVP layout schema as `version: 2` only and reject unsupported versions.
- MUST keep frozen export separate from active interactive layout persistence and support one frozen CSV output per referenced dataset.
- MUST validate HDF5 input against the single-run schema contract before loading (`/vectors`, `/vector_names`, `/indep_var`, `/signals` + required attrs).
- MUST preserve canonical signal identifiers for action payloads and trace identity, even when signal tree display is hierarchical.

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
- 2026-02-12: Tuple-based trace payload contract accepted; host sends explicit `(x, y)` inline arrays for MVP and viewer does not infer X from dataset headers (ADR-0006).
- 2026-02-12: Cross-dataset axis mixing is allowed in MVP; semantic consistency responsibility remains with user (ADR-0008).
- 2026-02-12: Explicit layout files (`*.wave-viewer.yaml`) adopted as primary persistence artifact with host-managed YAML IO and `<csv>.wave-viewer.yaml` compatibility fallback (ADR-0012).
- 2026-02-12: Proposed host-authoritative state ownership (single writer) to eliminate host/webview dual-write races; pending ADR-0009 acceptance.
- 2026-02-12: Proposed revisioned intent-only protocol (`webview/intent/*`, host revision gating) for deterministic sync and stale-message rejection; pending ADR-0010 acceptance.
- 2026-02-12: Proposed active-axis semantics where `Add to Plot` targets active axis and `Add to New Axis` activates the newly created axis; pending ADR-0011 acceptance.
- 2026-02-13: Adopted layout schema `version: 2` as MVP-only persistence contract with per-plot `x` and lane-grouped signals, removing `mode` from schema and dropping v1 compatibility (ADR-0013).
- 2026-02-13: Superseded dual-mode spec persistence with separate frozen bundle artifacts (`*.frozen.csv` + `*.frozen.wave-viewer.yaml`) to preserve interactive layout flow (ADR-0014, supersedes ADR-0007).
- 2026-02-13: Redefined layout schema `version: 2` as multi-dataset-first (`datasets[]`, dataset-qualified x/y signals) with no backward-compatibility import path (ADR-0015).
- 2026-02-13: Adopted single-explorer multi-viewer host routing with viewer auto-open behavior for viewer-dependent commands and layout-open flows (ADR-0016).
- 2026-02-13: Superseded single-CSV frozen bundle cardinality with multi-dataset frozen artifact sets (one frozen CSV per dataset + one frozen layout), keeping export/session separation (ADR-0017 supersedes ADR-0014 artifact cardinality).
- 2026-02-14: Accepted atomic reload replay snapshots so dataset reload updates apply as one coherent host snapshot (workspace + viewerState + tuples), avoiding stale trace vectors until later user intents (ADR-0018).
- 2026-02-17: Proposed normalized run-centric HDF5 ingestion contract to decouple simulator raw quirks from viewer ingestion and preserve adaptive/multi-dimensional sweep fidelity (ADR-0019).
- 2026-02-18: Accepted strict single-run HDF5 schema for MVP ingestion and hierarchical signal-tree display mapping while keeping canonical signal ids for actions/traces (ADR-0020).
- 2026-02-11: Multi-plot workspace uses tabs (not tiled layout) for MVP to keep state and deterministic replay simpler.
- 2026-02-11: Signal-to-axis assignment uses trace instances so one signal can be plotted on multiple axes.
- 2026-02-11: Axis model is provisioned for `y1..yN` now, while MVP UI can expose a smaller subset initially.
- 2026-02-11: Adopted domain-stacked Y-axis rendering in a single figure with shared X-axis/rangeslider (no subplot sync model); see ADR-0002.
- 2026-02-11: Adopted side-panel-first signal workflow with transitional fallback policy; see ADR-0003.
- 2026-02-11: Adopted explicit versioned host-webview protocol contract and runtime validation requirement; see ADR-0004.
- 2026-02-11: Deferred custom-editor migration until side-panel-first refactor stabilization criteria are met; see ADR-0005.
