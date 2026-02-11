# Side-Panel Workflow Spec

## Purpose
Define the normative side-panel-first interaction model for signal discovery, quick actions, and drag/drop plotting in Wave Viewer.

## Surfaces and responsibilities
- Side panel is the primary discovery/action surface for signals.
- Webview is the primary rendering/manipulation surface for plots, traces, and axes.
- Extension host owns command handling and state mutation dispatch.

## Signal browser requirements
- Must display numeric signals from the active dataset.
- Must support deterministic ordering (stable by column order unless explicitly grouped).
- Must support single-select actions first; multi-select is optional and deferred.

## Required side-panel actions
- `Add to Plot`
  - Adds selected signal to active/default target axis in active plot.
- `Add to New Axis`
  - Creates one axis and appends one trace instance bound to that new axis.
- `Reveal in Plot`
  - Focuses plot tab and highlights existing trace instances for the selected signal when present.

## Drag/drop contract
- Drag source is a signal tree item.
- Drop targets are axis row targets and the canvas domain overlay.
- Webview normalizes every drop into one event shape (`webview/dropSignal`) and sends it to host.
- Host resolves target axis behavior and dispatches reducer actions.

## Drop target semantics
- Axis row drop:
  - Uses explicit `axisId` target.
- New-axis drop affordance:
  - Uses `target.kind = "new-axis"`.
- Canvas overlay drop:
  - Maps pointer location to axis lane domain and resolves to concrete `axisId`.

## Determinism constraints
- Side-panel command path and drag/drop path MUST converge to same reducer-level operation semantics.
- Trace append order MUST be deterministic for repeated inputs.
- No direct webview-only state mutation may bypass host/reducer flow.

## Transitional fallback policy
- In-webview signal controls remain enabled until side-panel workflow stabilization criteria are met.
- Parity criteria:
  - side-panel command actions available
  - lane-targeted drag/drop available
  - regression tests cover both side-panel command and drag/drop paths
- Deprecation of in-webview signal-add controls is deferred until stabilization is confirmed in follow-up tasks.

## Verification
- Unit tests for signal-add reducer convergence across all entry paths.
- Unit tests for canvas-domain hit-testing and axis row target resolution.
- Extension smoke tests for command wiring and message bridge routing.
