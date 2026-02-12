# ADR-0009: Host-Authoritative Workspace and Viewer State

## Status
Proposed

## Context
The current architecture allows both extension host and webview to mutate workspace-adjacent state. This introduces race conditions, stale snapshot overwrites, and hard-to-debug behavior when side-panel commands and webview reducer updates interleave.

Recent bugs show that dual-writer state ownership can wipe or regress axis/trace assignments when one side applies an action from stale cache while the other side publishes a later snapshot.

## Decision
- Make extension host the single writer for:
  - `WorkspaceState` (plots, axes, traces)
  - viewer interaction state (`activePlotId`, `activeAxisByPlotId`)
- Treat webview as projection/controller only:
  - render host-authoritative state
  - emit user intents
  - do not publish full workspace snapshots
- Keep reducer logic deterministic and shared, but only host applies authoritative mutations.

## Consequences
- Eliminates dual-write race class by construction.
- Makes action provenance clear and debuggable (all committed state passes through host transaction path).
- Increases host responsibilities for session/viewer synchronization and validation.

## Alternatives
- Keep dual-write model and add ad-hoc reconciliation:
  - Rejected because reconciliation complexity grows quickly and still allows stale writes.
- Make webview authoritative and host advisory:
  - Rejected because side-panel actions originate in host and require authoritative routing/binding context.
