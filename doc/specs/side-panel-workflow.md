# Side-Panel Workflow Spec

## Purpose
Define the normative side-panel-first interaction model for signal discovery, quick actions, and drag/drop plotting in a host-authoritative Wave Viewer architecture.

## Surfaces and responsibilities
- Side panel is the primary discovery/action surface for signals.
- Webview is the primary rendering/manipulation surface for plots, traces, and axes.
- Extension host owns command handling, state mutation, and active-target routing.
- A single side panel MUST support routing actions to multiple live viewer sessions.

## Signal browser requirements
- Must display numeric signals from loaded datasets.
- Must support deterministic ordering (stable by column order unless explicitly grouped).
- Must support single-select actions first; multi-select is optional and deferred.
- Must keep dataset identity visible for each signal entry to disambiguate same-named signals across runs.

## Required side-panel actions
- `Add to Plot`
  - Adds selected signal to active axis in active plot of the resolved target viewer.
  - If no valid active axis exists, host falls back to first axis; if none exists, host creates one axis then appends trace.
  - If no eligible target viewer exists, host opens a new viewer and applies the action.
- `Add to New Axis`
  - Creates one axis and appends one trace instance bound to that new axis in the resolved target viewer.
  - Newly created axis becomes the active axis for the plot.
  - If no eligible target viewer exists, host opens a new viewer and applies the action.
- `Reveal in Plot`
  - Focuses plot tab and highlights existing trace instances for the selected signal when present.

## Drag/drop contract
- Drag source is a signal tree item.
- Drop targets are axis row targets and the canvas domain overlay.
- Webview normalizes every drop into one intent shape (`webview/intent/dropSignal`) and sends it to host.
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
- No direct webview-only structural state mutation may bypass host/reducer flow.
- "Add signal to new axis" MUST be atomic: create axis + append trace + set active axis in one transaction.
- Trace identity MUST remain dataset-qualified (`dataset + signal`) so same signal names from different datasets remain distinct.

## Active axis semantics
- Active axis is scoped per plot (`activeAxisByPlotId[plotId]`).
- Active axis is the default target for:
  - Explorer `Add to Plot`
  - Explorer double-click quick add
- Active axis changes when:
  - user explicitly selects an axis target in webview
  - plot changes and a valid per-plot active axis exists
  - new-axis operations succeed (new axis becomes active)
- If active axis is removed:
  - host reassigns active axis deterministically to reassignment target or first axis.

## Target viewer routing
- Explorer actions resolve target viewer in this order:
  - explicit target viewer (if user selected/pinned one),
  - focused viewer if it can accept the action,
  - most-recently-focused viewer bound to the action dataset,
  - new viewer creation.
- Target resolution MUST be host-side and deterministic.
- Routing must not require a pre-focused viewer for command success.

## State synchronization policy
- Host is state authority and emits revisioned snapshot/patch updates.
- Webview emits intents only and never sends full workspace snapshots.
- Webview ignores stale host state revisions (`revision <= lastAppliedRevision`).
- Opening a layout from command palette with no active viewer MUST create a viewer and bind imported state without error.

## Verification
- Unit tests for signal-add reducer convergence across all entry paths.
- Unit tests for canvas-domain hit-testing and axis row target resolution.
- Unit tests for active-axis fallback, reassignment, and new-axis activation.
- Extension smoke tests for command wiring and revisioned intent/state routing.
