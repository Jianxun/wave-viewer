# ADR-0018: Atomic Reload Replay Snapshots

Status: Accepted

## Context
`Reload All Files` currently updates loaded CSV datasets and then incrementally pushes tuple updates to webviews. In practice, this path is non-deterministic for already-rendered traces:
- tuple refresh can miss viewers when dataset/trace path identity differs across sessions or imported layouts,
- tuple cache updates and workspace updates are not guaranteed to arrive as one atomic unit,
- users observe that waveforms refresh only after a later interaction (for example, adding a new trace).

`layoutExternalEdit:file-watch` already demonstrates a stronger replay pattern: host computes canonical workspace + tuple payloads and broadcasts a coherent state update.

## Decision
Adopt atomic reload replay as the required protocol behavior for dataset reload flows.

For reload-triggered updates, host MUST send one authoritative replay snapshot per targeted viewer:
- `revision`
- full `workspace`
- full `viewerState`
- full `tuples` required by current workspace traces
- `reason` (for diagnostics)

Webview MUST apply replay snapshots atomically:
- replace workspace/viewer interaction state,
- replace tuple cache for replay scope (not merge-only stale retention),
- render once from the resulting coherent state.

Incremental tuple upserts remain valid for interaction-time additions (side-panel add/drop), but not as the sole mechanism for dataset reload synchronization.

## Consequences
- Eliminates reload races where traces remain stale until unrelated user actions.
- Reload behavior becomes deterministic and testable as one host transaction boundary.
- Slightly larger payloads during reload, acceptable for MVP correctness priority.

## Alternatives
- Keep incremental tuple upserts and add more heuristics for viewer targeting/cache invalidation.
  - Rejected: complexity grows and still leaves ordering/consistency gaps.
- Force synthetic webview actions after reload to trigger redraw.
  - Rejected: hides root cause, introduces non-contract side effects.
