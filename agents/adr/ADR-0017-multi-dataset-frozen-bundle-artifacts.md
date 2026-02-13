# ADR-0017: Multi-Dataset Frozen Bundle Artifact Set

## Status
Accepted

## Context
ADR-0014 established separate frozen artifacts from interactive layout persistence as a pair (`*.frozen.csv` + `*.frozen.wave-viewer.yaml`). After adopting multi-dataset `version: 2` layouts (ADR-0015), a single frozen CSV no longer represents all referenced datasets.

## Decision
- Keep frozen export as a separate artifact workflow from interactive layout persistence.
- Export one frozen layout YAML plus one frozen CSV per referenced dataset id.
- Frozen layout keeps `version: 2` schema and rewrites `datasets[].path` to generated frozen CSV paths.
- Interactive session binding must remain unchanged after frozen export.

## Consequences
- Frozen replay remains deterministic for multi-dataset workspaces.
- Export path logic and overwrite safeguards must validate multiple dataset outputs.
- ADR-0014 is superseded for artifact cardinality but retained as historical context.

## Alternatives
- Merge datasets into one frozen CSV:
  - Rejected because it loses dataset boundaries and complicates deterministic dataset-qualified references.
- Keep single frozen CSV and restrict mixed-dataset export:
  - Rejected because it blocks core comparison workflows.
