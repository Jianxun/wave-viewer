# Host-Webview Protocol Spec

## Purpose
Define versioned message contracts between extension host and webview for Wave Viewer interactions.

## Envelope
All messages use this envelope:

```ts
type ProtocolEnvelope<TType extends string, TPayload> = {
  version: 1;
  type: TType;
  payload: TPayload;
};
```

Rules:
- `version` is required on every message.
- `type` is required and namespaced by sender (`host/...`, `webview/...`).
- Unknown `type` must be ignored with debug logging; must not crash UI.

## Host -> webview messages
- `host/datasetLoaded`
  - payload: `{ datasetPath: string; signals: string[]; defaultXSignal: string }`
- `host/workspaceLoaded`
  - payload: `{ workspace: WorkspaceState }`
- `host/workspacePatched`
  - payload: `{ workspace: WorkspaceState; reason: string }`

## Webview -> host messages
- `webview/workspaceChanged`
  - payload: `{ workspace: WorkspaceState; reason: string }`
- `webview/dropSignal`
  - payload:
    - `signal: string`
    - `plotId: string`
    - `target: { kind: "axis"; axisId: string } | { kind: "new-axis" }`
    - `source: "axis-row" | "canvas-overlay"`
- `webview/command`
  - payload:
    - `command: "zoomToFit" | "cancelGesture" | "revealSignal"`
    - `args?: Record<string, unknown>`

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
- Unit tests for `webview/dropSignal` target variants.
- Smoke tests for host-webview roundtrip on dataset load and signal add/drop flows.
