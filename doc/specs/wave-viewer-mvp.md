# Wave Viewer MVP Spec

## 1. Scope

### 1.1 Goal
Build a VS Code extension (`wave-viewer`) that opens CSV waveform data and enables interactive plotting with Plotly, then exports a deterministic YAML spec for replay.

### 1.2 In Scope (MVP)
- CSV input only.
- Launch viewer from a CSV file in VS Code.
- Two-pane layout:
  - Left pane: signal browser and trace/axis controls.
  - Right pane: Plotly canvas.
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

## 3.1 Layout
- Left pane sections:
  - Plot tab selector (add/rename/remove tab).
  - X-signal selector for active plot.
  - Signal list with search/filter.
  - Trace instance list for active plot.
  - Axis manager for active plot.
- Right pane:
  - Plotly chart for active plot.
  - Chart is one Plotly figure with shared X-axis and domain-stacked Y-axes.

### 3.2 Signal Selection and Add-to-Axis
- Signal list rows show:
  - Signal name
  - `+` action to add trace
- `+` action opens an axis menu:
  - Existing axes (`Y1`, `Y2`, `Y3`, ...)
  - `Create new axis`
- Selecting a menu entry appends a new trace instance for that signal on chosen axis.
- Same signal may be appended multiple times to different axes (or same axis) as independent trace instances.

### 3.3 Trace Instance Controls
- Trace list row shows:
  - Signal name
  - Axis selector (`Y1`, `Y2`, ...)
  - Visibility toggle
  - Delete action
- Axis selector reassigns trace to target axis immediately.
- Trace order is user-visible and should be deterministic for export.

### 3.4 Axis Manager
- Per active plot:
  - Create axis (`YN`).
  - Remove axis (blocked if in use unless user confirms reassignment/delete).
  - Set title, optional range, and scale mode.
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

## 5. Plotly Mapping Rules

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

## 6. YAML Spec (Deterministic Replay)

### 6.1 Purpose
Capture enough state so importing the YAML reproduces the same plot workspace from the same dataset.

### 6.2 Spec Requirements
- Include:
  - version
  - dataset path reference
  - plots, axes, traces, x-signal, ranges, visibility, order
- Exclude:
  - transient UI-only state not affecting rendered output.

### 6.3 Determinism Guarantees
- Given identical CSV and YAML spec, reconstructed workspace must match:
  - plot/tab structure
  - axis definitions and assignment
  - trace order and visibility
  - x/y ranges when provided
- Missing referenced signals must produce explicit errors listing missing names and affected plots.

## 7. Initial Quality Gates

- Parser unit tests for:
  - numeric detection
  - malformed rows
  - default X selection logic
- State-to-Plotly adapter tests for:
  - N-axis mapping
  - same signal on multiple axes
- Spec round-trip tests:
  - state -> YAML -> state equality for deterministic fields
- Smoke scenario:
  - open `examples/simulations/ota.spice.csv`
  - create at least 2 tabs with different X signals
  - assign one signal to multiple axes
  - export/import YAML and verify visual/state parity
- Execution policy during MVP:
  - CI gates are not required yet.
  - Follow `doc/specs/testing-strategy.md` and record skipped checks in task scratchpads.

## 8. Open Follow-ups (Post-MVP Candidates)

- Tiled/scrollable multi-canvas layout.
- Downsampling strategies for very large CSV files.
- More axis types and richer styling presets.
