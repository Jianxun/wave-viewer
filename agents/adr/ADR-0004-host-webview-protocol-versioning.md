# ADR-0004: Versioned Host-Webview Protocol

## Status
Accepted

## Context
Side-panel-first workflows add more host/webview interaction surfaces (commands, drag/drop, lane targeting). Existing message passing is functionally sufficient but under-specified, which risks incompatibilities, silent breakage, and non-deterministic behavior when features evolve.

A durable protocol policy is needed before broader interaction expansion.

## Decision
- Define host/webview communication as explicit typed envelopes with required `version`, `type`, and `payload`.
- Standardize core message types for dataset load, workspace sync, command forwarding, and `webview/dropSignal`.
- Treat additive fields as backward-compatible; treat required-field removal/rename as version-breaking.
- Require validation of inbound messages on both host and webview boundaries.

## Consequences
- Message evolution becomes predictable and testable.
- Slight upfront implementation and test overhead for schema validation.
- Future incompatible protocol changes require explicit migration handling instead of implicit behavior changes.

## Alternatives
- Continue with implicit ad-hoc message payloads:
  - Rejected because hidden coupling is likely to increase as drag/drop and keyboard actions expand.
- Use compile-time types only without runtime validation:
  - Rejected because host/webview boundary is runtime message-based and needs runtime guards.
