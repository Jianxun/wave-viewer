# ADR-0019: Normalized HDF5 Waveform Ingestion Contract

Status: Proposed

## Context
Wave Viewer currently ingests CSV. Simulator raw formats differ across engines and analyses (naming, hierarchy, complex AC vectors, multi-dimensional sweeps, adaptive transient timesteps). Directly teaching viewer code every raw quirk increases coupling and maintenance risk.

A candidate HDF5 shape already exists in the repository (`examples/simulations/tb.spice.h5`) and demonstrates an important pattern: canonical vectors with hierarchical VDS aliases.

## Decision
Adopt a normalized HDF5 contract as the simulator-agnostic ingestion boundary for non-CSV waveform data.

The normalized contract MUST be run-centric:
- each run stores its own independent variable and signal vectors,
- no requirement for one global rectangular sweep cube,
- hierarchical signals are represented as VDS aliases to canonical run vectors,
- sweep/corner metadata is modeled as tagged run descriptors.

Specification source of truth: `doc/specs/hdf5-normalized-waveform-format.md`.

## Consequences
- Viewer ingestion can stay simple and stable while raw adapters absorb simulator-specific quirks.
- Adaptive transient and sparse/multi-dimensional sweep data remain lossless without forced interpolation.
- Implementation scope increases: we need HDF5 loader and run-selection UX/schema integration.

## Alternatives
- Parse simulator raw formats directly in extension host.
  - Rejected: format-specific complexity leaks into viewer ingestion and scales poorly.
- Normalize to a dense N-D sweep cube.
  - Rejected: incompatible with adaptive timesteps and sparse sweep coverage without lossy resampling.
