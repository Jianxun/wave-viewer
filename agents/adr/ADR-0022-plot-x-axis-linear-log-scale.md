# ADR-0022: Per-Plot X-Axis Linear/Log Scale with Host-Authoritative Range Semantics

Status: Accepted

## Context
AC frequency-response plotting requires logarithmic X-axis support to be usable for core workflows.

The current model already supports Y-axis lane scale (`linear`/`log`) and host-authoritative workspace updates, but X-axis scale is not yet represented as first-class plot state. We need X-log support without weakening determinism for relayout, YAML replay, and host/webview revisioned synchronization.

## Decision
Adopt native Plotly X-axis log mode as a per-plot setting with host-authoritative state updates.

1. Add per-plot X-axis scale state (`linear` | `log`) with default behavior `linear`.
2. X-axis scale updates are intent-driven and host-authoritative (single-writer rule), not webview-local state.
3. Persisted `x.range` values remain in raw data units for both linear and log scales.
4. Rendering/relayout paths convert between raw units and Plotly axis units as an adapter concern:
   - linear: identity
   - log: Plotly-facing values use `log10(raw)`
5. Log toggle validation is strict:
   - If the active plot has no positive finite X samples, reject toggle-to-log with actionable error and keep current scale.
   - No silent filtering, clamping, absolute-value transform, or epsilon substitution for invalid X samples.
6. If toggling to log with an existing persisted `x.range` containing non-positive bounds, clear `x.range` and use autorange.
7. Keep X-axis rangeslider enabled in log mode to preserve interaction consistency.
8. Protocol/spec updates are additive and backward-compatible:
   - Introduce an intent for plot X-axis updates (scale and X-range patch semantics).
   - Extend layout schema with optional `x.scale` (`linear` | `log`); omitted means `linear`.

## Consequences
- AC workflows gain required X-log behavior without introducing non-deterministic local state.
- Replay/import/export remain stable because persistence stays in raw data units.
- Adapter complexity increases due to scale-aware range conversion and validation paths.
- Some datasets that include non-positive X values will explicitly fail log toggles rather than partially render.

## Alternatives
- Auto-transform X (for example `abs(x)` or epsilon floor) when log is requested.
  - Rejected: changes data semantics silently and undermines user trust.
- Allow log toggle and rely on renderer to drop invalid points.
  - Rejected: implicit data loss and ambiguous behavior across interactions/replay.
- Add separate persisted range representations for linear and log domains.
  - Rejected: unnecessary schema/state complexity for MVP compared with adapter-side conversion.
