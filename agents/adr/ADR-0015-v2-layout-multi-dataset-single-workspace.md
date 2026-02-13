# ADR-0015: v2 Layout Supports Multi-Dataset Workspaces

## Status
Accepted

## Context
Wave Viewer already allows cross-dataset axis mixing at runtime (ADR-0008), but the current v2 YAML contract models only one dataset (`dataset.path`). This mismatch blocks deterministic replay for real comparison workflows (for example, comparing `V(out)` across two runs in one viewer).

The project is in MVP phase and explicitly does not require backward compatibility for layout schema revisions.

## Decision
- Redefine layout schema `version: 2` to model multiple datasets directly.
- Replace single `dataset.path` with:
  - required `datasets[]` registry (`id`, `path`)
  - required `active_dataset`
- Require dataset-qualified signal references in plots:
  - `plots[].x` requires both `dataset` and `signal`
  - `plots[].y[].signals` maps labels to `{ dataset, signal }`
- Import/export remains v2-only with no compatibility path for pre-change v2 files.

## Consequences
- One layout can deterministically replay mixed-dataset traces and X assignments.
- Existing v2 files using single `dataset.path` are intentionally breaking and must be regenerated.
- Host/spec layers must validate dataset IDs and dataset-qualified signal references uniformly.

## Alternatives
- Introduce `version: 3`:
  - Rejected because MVP explicitly accepts breaking schema evolution and benefits from avoiding dual-path maintenance.
- Keep single dataset in schema and treat mixed datasets as runtime-only:
  - Rejected because replay/export would be lossy and non-deterministic.
