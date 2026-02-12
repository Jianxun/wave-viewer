# ADR-0010: Revisioned Intent-Based Host-Webview Protocol

## Status
Proposed

## Context
The existing protocol mixes state snapshots with interaction messages and currently allows webview-to-host full workspace publication. Without revision ordering, receivers cannot reliably reject stale updates.

A clean architecture requires protocol semantics that separate intents from authoritative state and provide deterministic ordering guarantees.

## Decision
- Move to an intent-based webview-to-host contract:
  - `webview/intent/*` messages for user actions only.
- Move to host-authoritative state publication:
  - `host/stateSnapshot` for initial/reconnect sync.
  - `host/statePatch` for post-transaction updates.
- Require monotonic `revision` on host state-bearing messages.
- Require webview stale-message rejection rule:
  - ignore host state messages where `revision <= lastAppliedRevision`.
- Keep tuple data transport separate from structural state:
  - `host/tupleUpsert` carries `(x, y)` arrays and tuple metadata only.

## Consequences
- Deterministic ordering and replay of state transitions.
- Clear protocol semantics: intents in, authoritative state out.
- Requires migration of existing handlers/tests and temporary compatibility shims during rollout.

## Alternatives
- Keep snapshot-style messages without revisions:
  - Rejected because out-of-order/stale overwrites remain possible.
- Add timestamp-based conflict resolution:
  - Rejected because wall-clock ordering is weaker and harder to test than revision sequencing.
