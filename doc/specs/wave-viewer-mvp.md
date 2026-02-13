# Wave Viewer MVP Spec

## 1. Scope

### 1.1 Goal
Build a VS Code extension (`wave-viewer`) that opens CSV waveform data and enables interactive plotting with Plotly, then exports a deterministic YAML spec for replay.

### 1.2 In Scope (MVP)
- CSV input only.
- Launch viewer from a CSV file in VS Code.
- Primary workflow is side-panel-first signal discovery and plotting actions.
- Main viewer webview is focused on plotting, axis management, and lane-level interactions.
- Transitional fallback keeps in-webview signal controls available until side-panel workflow is implemented and stabilized.
- Multi-plot workspace via tabs (each tab is one plot).
- Per-plot configurable X-axis signal.
- Signal plotted multiple times across different Y-axes (trace instances).
- N-axis-capable data model (`y1`, `y2`, `y3`, ...) rendered as vertically stacked non-overlapping Y-axis domains in a single Plotly figure.
- One shared X-axis and one rangeslider per plot tab.
- Export/import deterministic YAML plot spec.

### 1.3 Out of Scope (MVP)
- Non-CSV formats.
- Remote data sources.
- Tiled/scrolling dashboard layout.
- Collaboration/sync features.
- Mandatory migration to custom editor architecture in MVP.

## 2. Input Data Contract

### 2.1 CSV Requirements
- UTF-8 text CSV with header row.
- Columns are candidate numeric signals.
- Rows are samples in source order.

### 2.2 Parsing Rules
- Attempt numeric parsing per column.
- Non-numeric columns are excluded from plottable signal list.
- If no numeric columns exist, show actionable error.
- CSV does not require a `time` column.

### 2.3 Default X Signal
- If a `time` column exists, default X to `time`.
- Else default X to first numeric column.
- User may override X at any time per plot tab.

## 3. UI and Interaction Model

### 3.1 Surfaces
- Side panel (primary discovery/action surface):
  - Signal tree for numeric signals from active dataset.
  - Command/context actions (`Add to Plot`, `Add to New Axis`, `Reveal in Plot`).
  - Drag source for signal-to-lane drop workflows.
- Main webview (primary manipulation/rendering surface):
  - Plot tab selector.
  - X-signal selector for active plot.
  - Trace instance list for active plot.
  - Axis manager for active plot.
  - Plotly chart with domain-stacked lanes.

Detailed behavior is specified in `doc/specs/side-panel-workflow.md`.

### 3.2 Signal Add/Reassign Semantics
- All user entry paths (side-panel command, side-panel drag/drop, fallback in-webview control) MUST converge to the same reducer action contract.
- Adding a signal appends a trace instance for a concrete target axis (`yN`), creating a new axis only through explicit action.
- Active axis is a per-plot concept and is the default target for `Add to Plot` and explorer quick-add.
- `Add to New Axis` MUST create the new axis, append the trace to it, and set that new axis as active in one host transaction.
- Same signal may be appended multiple times to different axes (or the same axis) as independent trace instances.

### 3.3 Trace and Axis Controls
- Trace row shows signal name, axis selector, visibility toggle, and delete action.
- Axis selector reassigns trace to target axis immediately.
- Axis manager supports create/remove/reorder and axis metadata updates.
- Axis order controls top-to-bottom lane order.
- Axis IDs are stable (`y1`, `y2`, ...), never reused within one plot after deletion in the same session.

## 4. Internal Data Model

### 4.1 Dataset
```ts
type Dataset = {
  path: string;
  rowCount: number;
  columns: Array<{
    name: string;
    values: number[];
  }>;
};
```

### 4.2 Workspace / Plot State
```ts
type AxisId = `y${number}`;

type AxisState = {
  id: AxisId;         // y1, y2, y3...
  title?: string;
  range?: [number, number];
  scale?: "linear" | "log";
};

type TraceState = {
  id: string;         // stable instance id
  signal: string;     // source column name
  axisId: AxisId;     // target y-axis
  visible: boolean;
  color?: string;
  lineWidth?: number;
};

type PlotState = {
  id: string;
  name: string;
  xSignal: string;
  axes: AxisState[];
  traces: TraceState[];
  xRange?: [number, number];
};

type WorkspaceState = {
  activePlotId: string;
  plots: PlotState[];
};
```

## 5. Host-Webview Protocol Contract

- Host/webview messaging MUST use explicit message types and schema-validated payloads.
- Host is the authoritative state owner; webview emits intents and renders host-issued state.
- Host state messages MUST include monotonic revision numbers; webview MUST ignore stale revisions.
- Protocol changes MUST follow compatibility/versioning rules in `doc/specs/host-webview-protocol.md`.
- Drag/drop signal operations MUST emit normalized `webview/intent/dropSignal` events to the host.

## 6. Plotly Mapping Rules

- Each plot tab renders as a single figure with:
  - one shared `xaxis`
  - one shared `xaxis.rangeslider`
  - `yaxis`, `yaxis2`, ... configured with non-overlapping `domain` values.
- `axisId=y1` maps to Plotly `yaxis`.
- `axisId=yN` maps to Plotly `yaxisN` for `N>=2`.
- Trace mapping:
  - `x = dataset.columns[xSignal].values`
  - `y = dataset.columns[trace.signal].values`
  - `yaxis = "y" | "y2" | ...`
- Axis definitions derive from `axes[]` order and settings.
- This design intentionally avoids multi-canvas subplot synchronization mechanisms.
- Detailed execution target: `doc/specs/domain-stacked-shared-x-implementation.md`.

## 7. YAML Spec (Deterministic Replay)

### 7.1 Purpose
Capture enough state so importing the YAML reproduces the same plot workspace from the same dataset.

### 7.2 Spec Requirements
- Supported schema is `version: 2` only (MVP clean refactor).
- Include:
  - `version`
  - `dataset.path` reference (absolute or layout-relative)
  - `active_plot`
  - `plots[]` with per-plot `x` config:
    - required `x.signal`
    - optional `x.label`
    - optional `x.range`
  - `plots[].y[]` lane groups with:
    - required lane `id` (human-editable)
    - optional lane `label`, `scale`, `range`
    - `signals` map (`label -> dataset signal`)
- Exclude:
  - transient UI-only state not affecting rendered output.
  - `mode` field (not part of v2 schema).
  - per-trace `visible` field (import defaults to visible).
- Explicit `*.wave-viewer.yaml` files are the primary interactive persistence artifact.
- `<csv>.wave-viewer.yaml` fallback identity remains supported when no explicit layout is bound.
- When a layout file and CSV are colocated, exports should prefer relative dataset references (for example `./trace.csv`) to reduce machine-specific path coupling.
- Frozen/exportable snapshots are produced as separate artifacts:
  - `<name>.frozen.csv`
  - `<name>.frozen.wave-viewer.yaml` (same v2 schema, referencing frozen CSV)
  - Frozen export must not rebind or overwrite the active interactive layout file.

Example:
```yaml
version: 2
dataset:
  path: ./tb.spice.csv
active_plot: plot-1
plots:
  - id: plot-1
    name: Inverter Chain Transient
    x:
      signal: TIME
      label: Time (s)
    y:
      - id: lane-io
        label: Voltage (V)
        signals:
          V_IN: V(IN)
          V_OUT: V(OUT)
      - id: lane-a
        signals:
          V_A: V(A)
```

### 7.3 Determinism Guarantees
- Given identical CSV and YAML spec, reconstructed workspace must match:
  - plot/tab structure
  - lane definitions and assignment
  - trace order (visibility defaults to `true` on import)
  - x/y ranges when provided
- Missing referenced signals must produce explicit errors listing missing names and affected plots.
- Lane IDs are user-facing identifiers; host/runtime maps lanes deterministically to internal canonical axes (`y1..yN`) by per-plot lane order for rendering.

## 8. Initial Quality Gates

- Parser unit tests for:
  - numeric detection
  - malformed rows
  - default X selection logic
- State-to-Plotly adapter tests for:
  - N-axis mapping
  - same signal on multiple axes
- Host/webview protocol tests for:
  - message schema validation
  - `webview/dropSignal` handling for axis-target and new-axis-target paths
  - deterministic convergence from all signal-add entry points
- Spec round-trip tests:
  - state -> YAML -> state equality for deterministic fields
- Smoke scenario:
  - open `examples/simulations/ota.spice.csv`
  - add traces from side panel
  - perform lane-targeted drag/drop
  - export/import YAML and verify visual/state parity
- Execution policy during MVP:
  - CI gates are not required yet.
  - Follow `doc/specs/testing-strategy.md` and record skipped checks in task scratchpads.

## 9. Known Limits (MVP)

- Lane height/gap behavior is deterministic and fixed (`g=0.04`), not adaptive to axis count.
- High lane counts can compress per-lane vertical space and reduce readability.
- Very large CSV performance optimization (for example, downsampling/decimation) is out of scope for MVP.
- Rendering assumes one shared Plotly figure per plot tab and does not provide alternate layout strategies.

## 10. Open Follow-ups (Post-MVP Candidates)

- Evaluate custom editor migration (`viewType`) after side-panel workflow stabilizes.
- Deprecate in-webview signal-add controls after side-panel workflow stabilization criteria are met.
- Downsampling strategies for very large CSV files.
- Grouped/tree taxonomies for large signal sets.
