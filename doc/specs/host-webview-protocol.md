# Host-Webview Protocol Spec

## Purpose
Define the target protocol contract for a host-authoritative Wave Viewer model where the webview emits user intents and renders host-issued state.

## Envelope
All messages use this envelope:

```ts
type ProtocolEnvelope<TType extends string, TPayload> = {
  version: 2;
  type: TType;
  payload: TPayload;
};
```

Rules:
- `version` is required on every message.
- `type` is required and namespaced by sender (`host/...`, `webview/...`).
- Unknown `type` must be ignored with debug logging; must not crash UI.
- Host state-bearing messages MUST include monotonic `revision: number`.

## State ownership
- Host is the single writer for workspace structure and viewer interaction state.
- Webview MUST NOT publish full workspace snapshots back to host.
- Webview emits intent messages only; host validates and applies reducer actions.

## Host -> webview messages
- `host/stateSnapshot`
  - payload: `{ revision: number; workspace: WorkspaceState; viewerState: ViewerState }`
  - full state payload used on initial ready/reconnect.
- `host/statePatch`
  - payload: `{ revision: number; workspace: WorkspaceState; viewerState: ViewerState; reason: string }`
  - authoritative incremental update; may still carry full normalized objects in MVP.
- `host/replaySnapshot`
  - payload: `{ revision: number; workspace: WorkspaceState; viewerState: ViewerState; tuples: SidePanelTraceTuplePayload[]; reason: string }`
  - authoritative atomic replay update for reload/import-class flows where workspace state and tuple cache must converge as one unit.
- `host/tupleUpsert`
  - payload: `{ tuples: SidePanelTraceTuplePayload[] }`
  - transports numeric `(x, y)` arrays and tuple metadata only for interaction-time incremental tuple additions.
- `host/viewerBindingUpdated`
  - payload: `{ viewerId: string; datasetPath?: string }`

## Webview -> host messages
- `webview/intent/setActivePlot`
  - payload: `{ viewerId: string; plotId: string; requestId: string }`
- `webview/intent/setActiveAxis`
  - payload: `{ viewerId: string; plotId: string; axisId: string; requestId: string }`
- `webview/intent/dropSignal`
  - payload:
    - `viewerId: string`
    - `signal: string`
    - `plotId: string`
    - `target: { kind: "axis"; axisId: string } | { kind: "new-axis" }`
    - `source: "axis-row" | "canvas-overlay"`
    - `requestId: string`
- `webview/intent/addSignalToActiveAxis`
  - payload: `{ viewerId: string; signal: string; requestId: string }`
- `webview/intent/addSignalToNewAxis`
  - payload: `{ viewerId: string; signal: string; requestId: string }`

## Ordering and replay rules
- Webview MUST ignore host state messages where `revision <= lastAppliedRevision`.
- Host MUST increment `revision` once per committed transaction.
- Compound operations (for example, "add signal to new axis") MUST be committed atomically under one new revision.
- Dataset reload flows MUST use `host/replaySnapshot` so workspace/viewerState/tuples are applied atomically in webview.

## Compatibility policy
- Additive payload fields are allowed in minor evolution and must be optional for receivers.
- Removing or renaming required fields requires protocol version bump.
- Any protocol version bump requires:
  - explicit ADR update
  - migration notes in `agents/context/contract.md`
  - tests for backward compatibility or explicit incompatibility handling

## Validation policy
- Host validates inbound webview messages before mutation.
- Webview validates inbound host messages before render update.
- Validation failures must be logged and surfaced as non-fatal notifications where feasible.

## Determinism rules
- Message handlers must dispatch deterministic reducer actions.
- Equivalent user intents from different UI paths must produce equivalent workspace deltas.
- Protocol messages must not include transient DOM-only state.

## Verification
- Unit tests for envelope/type/payload validation.
- Unit tests for revision monotonicity and stale-message rejection.
- Unit tests for intent-to-reducer transaction mapping.
- Smoke tests for host-authoritative roundtrip on explorer commands and drag/drop flows.
