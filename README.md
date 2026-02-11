# Wave Viewer

Wave Viewer is a VS Code extension for plotting numeric signals from local CSV files with a tabbed, multi-axis Plotly workspace.

## Usage Workflow

### 1) Open

1. Open `examples/simulations/ota.spice.csv` in VS Code.
2. Run `Wave Viewer: Open Active CSV` from the Command Palette.
3. Wait for the dataset status to confirm rows/signals were loaded.

### 2) Explore

1. In the signal list, add traces to the active plot.
2. Add a second plot tab from the tabs bar (`+`) to compare alternate signal groups.
3. Add axes (`y2`, `y3`, ...) from the axis manager and assign traces to different axes.
4. Use zoom/pan in the chart; range state is captured for replay.

### 3) Export

1. Keep the target CSV active in the editor.
2. Run `Wave Viewer: Export Plot Spec (YAML)`.
3. Save the generated `.wave-viewer.yaml` spec.

The export is deterministic for tab/axis/trace ordering and assignments.

### 4) Replay

1. Keep the same CSV active in the editor.
2. Run `Wave Viewer: Import Plot Spec (YAML)`.
3. Select the exported YAML file.

Wave Viewer restores tab state, axis assignments, trace visibility, and persisted ranges. If the spec references signals missing from the current CSV, import fails with an explicit error.

## Verification

- `npm run lint`
- `npm test`
- `npm run test:e2e`
