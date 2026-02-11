# ADR-0003: Side-Panel-First Signal Workflow

## Status
Accepted

## Context
Wave Viewer's original MVP interaction concentrated signal discovery and plotting controls inside the webview. This layout is workable for small datasets, but it scales poorly for high-signal-count workflows and mixes discovery concerns with rendering concerns.

VaporView findings indicate a stronger pattern: side panel for discovery/actions and main viewer for manipulation/rendering. We need a durable decision to align upcoming tasks and avoid ad-hoc UI divergence.

## Decision
- Adopt side-panel-first workflow as the primary signal interaction model.
- Keep webview focused on plotting, axis/lane interactions, and trace management.
- During migration, retain in-webview signal-add controls as transitional fallback until side-panel parity is verified.
- Require all signal-add paths (side-panel commands, drag/drop, fallback UI) to converge to the same reducer-level semantics.

## Consequences
- Improves scalability and ergonomics for larger signal sets.
- Introduces dual-path migration period that must be constrained by parity criteria and regression tests.
- Requires clear host/webview protocol definitions to prevent behavior drift across entry paths.

## Alternatives
- Keep webview-only signal workflow:
  - Rejected due to weaker discoverability and poor high-volume workflow ergonomics.
- Immediate hard cutover with no fallback:
  - Rejected due to migration risk and temporary loss of proven workflows during incremental implementation.
