# Normalized HDF5 Waveform Format (Draft v1)

## 1. Purpose

Define a simulator-agnostic waveform container so `wave-viewer` can ingest one stable format instead of simulator-specific raw quirks (`ngspice`, `Xyce`, Spectre, etc.).

This format is intentionally run-centric to support:
- multi-dimensional sweeps,
- adaptive transient timesteps,
- simulator-specific signal naming and hierarchy.

## 2. Design goals

- One canonical numeric contract for viewer ingestion.
- No required global rectangular sweep cube.
- Preserve source signal names and hierarchical names.
- Keep interpolation/resampling out of canonical data.
- Allow optional convenience aliases via HDF5 VDS.

## 3. File-level contract

Top-level file attributes (required):
- `format = "wave_viewer_hdf5"`
- `format_version = 1`
- `created_by` (tool + version string)
- `source_simulator` (for example: `xyce`, `ngspice`, `spectre`)
- `source_file` (original raw file path string, informational)

Top-level groups (required):
- `/runs`
- `/catalog`

## 4. Run-centric data model

Each physical simulation run/sweep point is represented as one run group:

- `/runs/<run_id>/attrs`
  - `analysis_type`: `dc | tran | ac | op | noise | custom`
  - `point_count`: integer
  - `is_complex`: boolean
  - `indep_name`: string (for example `time`, `freq`, `sweep`)
- `/runs/<run_id>/vectors`
  - shape: `(point_count, variable_count)`
  - dtype: `float64` for real-valued runs
  - dtype: compound `{re: float64, im: float64}` for complex-valued runs (AC)
- `/runs/<run_id>/vector_names`
  - shape: `(variable_count,)`
  - dtype: UTF-8 strings
- `/runs/<run_id>/indep`
  - 1D array, length `point_count`
  - VDS alias to the independent-variable column in `/runs/<run_id>/vectors`
- `/runs/<run_id>/signals/...`
  - hierarchical signal datasets as VDS aliases to columns in `/runs/<run_id>/vectors`
  - each signal dataset attrs:
    - `index` (column index in `vectors`)
    - `original_name` (simulator-native name)
    - `unit` (optional; for example `V`, `A`, `Hz`, `s`)

Notes:
- `run_id` is a stable opaque identifier (for example `run-000001`).
- Canonical numeric storage is `vectors`; `indep` and `/signals/*` are aliases (VDS), not duplicated payloads.

## 5. Sweep and corner metadata

`/catalog/runs` stores run descriptors (table-like records):
- `run_id` (string, required)
- `analysis_type` (string, required)
- `sweep_params` (JSON string, optional): key-value map for dimensions such as `TEMP`, `VDD`, Monte Carlo seed, process corner.
- `title` (optional)

Rationale:
- multi-dimensional sweeps become a set of tagged runs instead of one forced N-D numeric cube.
- adaptive timestep transients naturally keep per-run independent variable arrays.

## 6. Rules and invariants

- Canonical data MUST NOT require interpolation to be valid.
- A run’s signals MUST align only with that run’s `indep` array.
- `vector_names[index]` MUST match each signal alias `index`.
- Missing samples MUST be encoded as `NaN` (real) or `{re: NaN, im: NaN}` (complex), never by row deletion.
- Importers MUST treat unknown attributes/extra groups as non-fatal.

## 7. Wave Viewer ingestion mapping

Given one selected `run_id`, loader emits current in-memory `Dataset`:
- `Dataset.path = "<file>#<run_id>"`
- `rowCount = point_count`
- `columns = [{ name, values[] }]` from `vector_names` + `vectors` columns

Run selection policy (initial):
- default to first run in `/catalog/runs`;
- expose explicit run selection later in side panel and layout schema.

## 8. Non-goals for v1

- Cross-run interpolation/resampling.
- Canonical N-D gridded representation.
- Persisting viewer UI state in HDF5.

## 9. Compatibility and migration

- Existing CSV ingestion remains supported.
- Raw-to-HDF5 normalization can be done by external converters.
- Future loaders can add simulator-specific metadata under namespaced groups without breaking core ingestion.
