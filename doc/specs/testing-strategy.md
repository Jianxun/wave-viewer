# Wave Viewer Testing Strategy (MVP)

## Scope
This document defines how we validate Wave Viewer during MVP while implementation is intentionally incremental and may be in partial states.

## Principles
- Prefer fast feedback from local, deterministic tests.
- Prioritize correctness of data parsing, state transitions, and replay determinism.
- Allow temporary gaps during MVP, but every skipped check must be explicitly documented in task scratchpads.
- No CI gating is required during current MVP phase.

## Test Layers

### 1. Unit Tests (Primary)
- CSV parser behavior:
  - numeric column detection
  - malformed row handling
  - empty/no-numeric cases
- Default X-signal selection:
  - `time` preferred when present
  - first numeric fallback otherwise
- Workspace state reducers:
  - tab create/remove/activate
  - axis create/remove/reassign (`y1..yN`)
  - trace instance operations

### 2. Adapter Tests
- State-to-Plotly mapping:
  - axis id mapping (`y1 -> yaxis`, `yN -> yaxisN`)
  - same signal on multiple axes as separate trace instances
  - stable ordering of axes/traces for deterministic replay

### 3. Spec Round-Trip Tests
- Export/import parity for deterministic rendering fields:
  - tabs, x-signal, axes, trace assignments/order, ranges, visibility
- Import error coverage:
  - missing referenced signals
  - invalid axis ids/spec version errors

### 4. Integration and Smoke Tests
- Host/webview message bridge sanity.
- Load CSV and initialize first plot.
- User-path smoke with `examples/simulations/ota.spice.csv`:
  - create at least two plot tabs
  - use different x signals per tab
  - place same signal on multiple axes
  - export and re-import spec

## MVP Partial-State Policy
- If a task cannot run full verification due to unfinished dependencies, the executor MUST:
  - run all currently available relevant tests
  - record exact skipped commands and concrete reason in scratchpad
  - include manual validation evidence when automated tests are not yet possible

## Fixtures
- Keep small CSV fixtures for parser edge cases.
- Maintain one canonical replay fixture pair:
  - source CSV
  - expected YAML spec

## Required Per-Task Reporting
Each implementation task should report:
- Commands run
- Pass/fail outcomes
- Skips and reasons
- Residual risks
