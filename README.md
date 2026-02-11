# Wave Viewer

Wave Viewer is a VS Code extension for plotting numeric signals from local CSV files with a tabbed, multi-axis Plotly workspace.

## Usage Workflow

### 1) Open

1. Open `examples/simulations/ota.spice.csv` in VS Code.
2. Run `Wave Viewer: Open Active CSV` from the Command Palette.
3. Wait for the dataset status to confirm rows/signals were loaded.

### 2) Explore (Side-Panel First)

1. Use the side-panel signal browser as the primary signal workflow:
   - `Add to Plot` appends the signal to the active lane.
   - `Add to New Axis` creates a new lane and binds the signal to it.
   - `Reveal in Plot` activates the first plot containing that signal.
2. Add a second plot tab from the tabs bar (`+`) to compare alternate signal groups.
3. Add lanes (`y2`, `y3`, ...) from the axis manager and assign traces to each lane.
4. Reorder lanes in the axis manager to change top-to-bottom render order.
5. Use zoom/pan in the chart; one shared X-axis rangeslider controls all lanes, and captured ranges are persisted for replay.

### 3) Transitional Fallback (Still Supported)

1. In-webview signal-add controls remain available as a compatibility fallback during stabilization.
2. Fallback actions are expected to produce reducer-equivalent workspace outcomes relative to side-panel actions.
3. Deprecation of in-webview signal-add is deferred; no removal timeline is committed in the MVP window.

### 4) Export

1. Keep the target CSV active in the editor.
2. Run `Wave Viewer: Export Plot Spec (YAML)`.
3. Save the generated `.wave-viewer.yaml` spec.

The export is deterministic for tab/axis/trace ordering and assignments.

### 5) Replay

1. Keep the same CSV active in the editor.
2. Run `Wave Viewer: Import Plot Spec (YAML)`.
3. Select the exported YAML file.

Wave Viewer restores tab state, lane assignments, trace visibility, and persisted ranges. If the spec references signals missing from the current CSV, import fails with an explicit error.

## Known Limits (MVP)

- Lane height and gap are fixed for deterministic rendering; dense lane counts may reduce readability.
- Large CSV performance tuning (for very high sample counts) is not implemented yet.
- The viewer only supports local CSV workflows in VS Code (no remote connectors).

## Follow-ups (Post-MVP Candidates)

- Adaptive lane heights/gaps for high axis counts.
- Large-dataset decimation and related rendering performance work.
- Additional axis styling presets and presentation controls.

## Verification

- `npm run lint`
- `npm test`
- `npm run test:e2e`
