# Normalized HDF5 Waveform Format (Single-Run v1)

## Purpose

Define the one HDF5 schema Wave Viewer currently supports for SPICE-like waveforms.

This is intentionally **single-run only** for now. Multi-run/multi-corner schema is deferred.

## Required file attributes

- `format` (informational, expected `xyce_raw`)
- `num_points` (non-negative integer)
- `num_variables` (non-negative integer)
- `indep_var_name` (non-empty string)
- `indep_var_index` (non-negative integer)
- `source_file` (informational string)

## Required nodes

- `/vectors`
  - 2D numeric dataset, shape `(num_points, num_variables)`
- `/vector_names`
  - 1D string dataset, length `num_variables`
- `/indep_var`
  - group
- `/indep_var/<indep_var_name>`
  - 1D dataset, length `num_points` (typically VDS view into `/vectors[:, indep_var_index]`)
- `/signals`
  - group containing hierarchical signal datasets (typically VDS views into `/vectors`)

## Validation rules

- `/vectors` must be rectangular 2D numeric data.
- `/vector_names` length must equal `/vectors` column count.
- `num_points` must match `/vectors` row count.
- `num_variables` must match `/vectors` column count.
- `indep_var_index` must be in range of `/vectors` columns.
- `vector_names[indep_var_index]` must equal `indep_var_name`.

## Wave Viewer mapping

- Loader source of truth is `/vectors` + `/vector_names`.
- Output dataset identity is the file path itself (no run suffix).
- In-memory mapping:
  - `Dataset.path = <h5-file-path>`
  - `Dataset.rowCount = num_points`
  - `Dataset.columns = vector_names[i] -> vectors[:, i]`

## Non-goals (current)

- Multi-run catalogs (`/runs`, `/catalog/runs`)
- Cross-run selection
- Implicit interpolation/resampling
