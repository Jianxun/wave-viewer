# ADR-0006: Trace Payload Uses Explicit Independent-Variable Tuples

## Status
Accepted

## Context
Wave Viewer is moving to a side-panel-driven model where the Explorer/host chooses signals and pushes plotting data to the viewer. The viewer should hold only a subset of plotted data, not full CSV datasets.

The current signal-name-only routing assumes a shared dataset context and implicit X-axis selection. That assumption breaks for multi-run and multi-analysis workflows where traces can have different independent-variable grids (for example, transient traces with different time steps, or AC traces on frequency grids).

We need a durable protocol contract that makes each plotted trace self-contained and deterministic.

## Decision
- Define plotted trace payloads as explicit tuples of independent/dependent series:
  - `x: number[]` (independent variable samples)
  - `y: number[]` (waveform samples)
  - metadata including stable IDs (`traceId`, `sourceId`) and labels (`xName`, `yName`/`label`).
- Transport mode for MVP is full inline arrays in protocol payloads.
  - Performance optimization (chunking/handles/streaming) is explicitly deferred until post-MVP ergonomics validation.
- Shift X-axis responsibility to trace payload binding:
  - Viewer MUST NOT infer default X from dataset headers.
  - Viewer renders each trace from provided `(x, y)` pairs.
- Keep dataset parsing/selection in Explorer/host:
  - Explorer/host resolves which independent variable pairs with each waveform before sending to viewer.
- Extend host/webview protocol with versioned message types for trace upsert/remove operations using tuple payloads.
- Treat existing dataset-level payload flow as transitional compatibility path only; new work targets tuple-based protocol.

## Consequences
- Correct handling of mixed-grid traces across simulations/analyses without hidden X-axis assumptions.
- Clear separation of concerns: host handles data selection; viewer handles visualization/layout only.
- Larger per-trace payloads may increase message size and memory pressure; accepted for MVP speed and simplicity.

## Alternatives
- Keep signal-name-only payloads and infer X in viewer:
  - Rejected because it fails for mixed grids and reintroduces implicit coupling to dataset-wide assumptions.
- Send full dataset to viewer and let viewer derive all traces:
  - Rejected because it violates subset-data direction, increases viewer complexity, and weakens routing determinism.
