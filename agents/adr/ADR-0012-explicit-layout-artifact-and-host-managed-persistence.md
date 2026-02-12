# ADR-0012: Explicit Layout Artifact and Host-Managed Persistence

## Status
Accepted

## Context
Wave Viewer previously tied persistence hooks to dataset-bound viewer sessions. The current architecture has shifted: webview consumes tuple payloads and emits intents, while host is authoritative for workspace/viewer state.

Users need reproducible, diff-friendly layout persistence and the ability to maintain multiple layout variants for the same dataset. A purely implicit sidecar model per CSV is simple but constrains multi-layout workflows.

## Decision
- Treat layout YAML as an explicit first-class artifact: `*.wave-viewer.yaml`.
- Bind viewer sessions to a layout file identity (`layoutUri`) for persistence semantics.
- Keep YAML import/export/watch/write entirely in extension host.
- Keep webview tuple-only and intent-only; webview does not own file IO or persistence identity.
- Maintain backward-compatible fallback to `<csv>.wave-viewer.yaml` when no explicit layout file is selected.

## Consequences
- Enables multiple version-controlled layout variants per dataset with clear artifact boundaries.
- Preserves deterministic state ownership by routing all persistence through host transactions.
- Adds host complexity: layout-session routing, watcher loop suppression, and save/save-as command flows.

## Alternatives
- Dataset-only implicit sidecar (`<csv>.wave-viewer.yaml`) as the sole persistence identity:
  - Rejected because it limits experimentation with multiple layout variants on one dataset.
- Webview-managed YAML persistence:
  - Rejected because it violates host-authoritative state ownership and reintroduces dual-writer risk.
