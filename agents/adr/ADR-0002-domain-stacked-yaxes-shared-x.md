# ADR-0002: Domain-Stacked Y-Axes with Shared X-Axis

## Status
Accepted

## Context
Wave Viewer must support multi-lane waveform inspection while keeping X navigation intuitive and deterministic. We need a rendering architecture that allows one rangeslider and one shared X-zoom behavior without adding fragile synchronization logic across multiple canvases or subplot containers.

Two families of approaches were considered:
- Render multiple independent subplot/canvas regions and synchronize X ranges programmatically.
- Render one figure with one shared `xaxis` and multiple `yaxis*` domains stacked vertically.

## Decision
- For each plot tab, render a single Plotly figure with:
  - one shared `xaxis`
  - one shared `xaxis.rangeslider`
  - `yaxis`, `yaxis2`, `yaxis3`, ... configured with non-overlapping vertical `domain` ranges.
- Trace instances bind to axis IDs (`y1..yN`) and map to corresponding `yaxis*`.
- Axis order in state controls top-to-bottom lane order in rendering.

## Consequences
- Shared X zoom/pan/rangeslider behavior is inherent to the figure model.
- We avoid cross-subplot sync code paths that are error-prone and difficult to keep deterministic.
- Plot adapter complexity shifts to domain calculation and lane layout management.

## Alternatives
- Multi-canvas or subplot-sync architecture:
  - Rejected due to synchronization complexity, event race risk, and higher maintenance cost.
- Overlaid multi-axis approach (`overlaying: "y"`):
  - Rejected because it does not deliver stacked-lane readability expected for waveform inspection.
