# ADR-0021: Host-Side Complex Projection and Structured Signal Refs for AC Plotting

Status: Proposed

## Context
Normalized HDF5 AC datasets can encode vector samples as complex pairs `[re, im]`, while the Wave Viewer runtime contract is real-only (`number[]`) across host/webview protocol, reducer state, and plot adapter payloads.

We need AC usability (gain/phase workflows) without introducing complex-native protocol or reducer types, and without destabilizing deterministic layout/session replay.

## Decision
Adopt host-side complex support with lazy real-valued projection and structured layout signal refs.

1. HDF5 ingestion accepts either scalar `number` or complex pair `[number, number]` for vector samples.
2. Core runtime contract remains real-only: webview/protocol/reducer consume only finite `number[]` arrays.
3. Complex derived accessors are modeled symbolically and projected lazily when a trace tuple is emitted to the viewer.
4. Derived accessor set and order are fixed: `re`, `im`, `mag`, `phase`, `db20`.
5. Derived signal identity at runtime is string-based (`<base>.<accessor>`), but layout persistence uses structured signal refs:
   - `{ base: string, accessor?: "re"|"im"|"mag"|"phase"|"db20" }`
6. Frequency (independent variable) must be real-valued. If frequency samples are complex-encoded, import fails with an actionable error.
7. `db20` projection uses fixed floor policy with `eps = 1e-30` (approximately `-600 dB`) to guarantee finite output.

Projection math for each complex sample `(re, im)`:
- `re = re`
- `im = im`
- `mag = sqrt(re^2 + im^2)`
- `phase = atan2(im, re) * 180 / pi`
- `db20 = 20 * log10(max(mag, eps))`, `eps = 1e-30`

## Consequences
- No protocol envelope or reducer schema churn for complex-native types.
- AC workflows become first-class (`db20` + `phase`) while preserving deterministic replay.
- Layout schema must evolve to persist structured signal refs for accessor-safe identity.
- Projection cost is paid only for plotted traces, not all loaded complex signals.

## Alternatives
- Eagerly materialize all derived vectors at ingest time.
  - Rejected: unnecessary memory amplification for unplotted signals.
- Persist derived signals only as flat strings in layout YAML.
  - Rejected: brittle parsing/escaping and weaker long-term extensibility.
- Introduce complex-native protocol and reducer types.
  - Rejected: high churn and risk for limited MVP benefit.
