# Project Status

## Current state summary
- HDF5 single-run ingestion contract (`ADR-0020`) is merged and active.
- New AC complex-support direction is now proposed in `ADR-0021`: host-side lazy accessor projection, finite real-only runtime payloads, and structured layout signal refs.
- Task slice `T-065` to `T-067` is prepared to implement AC support without protocol/reducer complex-native changes.

## Last merged/verified status
- `T-064` done (PR #78) and archived.
- Context consistency check passed after planning updates:
  - `./venv/bin/python scripts/lint_tasks_state.py`

## Next 1-3 tasks
1. `T-065` implement lazy complex accessor projection and strict real independent-variable enforcement.
2. `T-066` add symbolic accessor children in signal tree and map base quick-add to `.db20`.
3. `T-067` migrate layout persistence to schema `version: 3` with structured signal refs `{base, accessor?}`.

## Known risks / unknowns
- Layout schema bump to `version: 3` intentionally rejects prior versions; migration tooling is deferred and may be needed soon.
- Lazy projection requires careful tuple emission paths so no eager accessor materialization leaks back in.
- Large AC datasets may still need projection-cache eviction policy after first implementation.
