# ADR-0020: Single-Run HDF5 Schema and Hierarchical Signal Tree Rendering

Status: Accepted

## Context
Wave Viewer added HDF5 loading, but schema expectations and UX behavior were still in transition:
- prior draft work described a run-centric normalized format (`/runs`, `/catalog/runs`) that was not aligned with the currently generated `tb.spice.h5` shape,
- the current production files are single-run and expose canonical vectors at root (`/vectors`, `/vector_names`) with VDS aliases for `indep_var` and `signals`,
- side-panel signal browsing presented canonical names (for example `V(XOTA:D)`) as a flat list, which hides structural hierarchy and reduces usability.

We need one clear implemented contract now, without backward compatibility paths, and a browsing model that reflects hierarchical signal intent.

## Decision
Adopt the current single-run HDF5 schema as the only supported HDF5 ingestion contract for MVP:
- required roots/groups: `/vectors`, `/vector_names`, `/indep_var/<indep_var_name>`, `/signals`,
- required file attrs: `num_points`, `num_variables`, `indep_var_name`, `indep_var_index`,
- loader source of truth is `/vectors` + `/vector_names`,
- dataset identity is file-path based (no run suffix),
- no compatibility for run-catalog schemas (`/runs`, `/catalog/runs`) in this slice.

Adopt hierarchical rendering in side-panel signal explorer:
- keep canonical signal identity unchanged for plotting/actions (for example `V(XOTA:D)`),
- derive display hierarchy for browsing (for example `XOTA -> V(D)`),
- apply hierarchy only to tree display/labels; action payloads still carry canonical signal ids.

Spec source of truth: `doc/specs/hdf5-normalized-waveform-format.md`.

## Consequences
- Contract is simpler and directly matches currently produced `tb.spice.h5` files.
- Any HDF5 file missing required single-run nodes (for example missing `/indep_var`) is rejected with actionable errors.
- Explorer signal navigation is more usable for hierarchical designs while preserving reducer/protocol identity stability.

## Alternatives
- Keep run-centric `/runs` + `/catalog/runs` as current contract.
  - Rejected: mismatched current file production and increased complexity before multi-run requirements are finalized.
- Keep flat signal list with canonical names only.
  - Rejected: poor hierarchy discoverability for nested design signals.
