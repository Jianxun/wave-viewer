import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { loadNormalizedHdf5Dataset } from "../../../../src/core/hdf5/loadNormalizedHdf5";

describe("loadNormalizedHdf5Dataset", () => {
  it("loads the first catalog run and maps it into Dataset with deterministic path identity", () => {
    const fixturePath = path.resolve(process.cwd(), "tests/fixtures/hdf5/normalized-valid.h5");

    const loaded = loadNormalizedHdf5Dataset(fixturePath);

    expect(loaded.runId).toBe("run-b");
    expect(loaded.dataset.path).toBe(`${fixturePath}#run-b`);
    expect(loaded.dataset.rowCount).toBe(3);
    expect(loaded.dataset.columns).toEqual([
      { name: "time", values: [0, 1, 2] },
      { name: "v(out)", values: [1, 1.5, 2] }
    ]);
  });

  it("throws an actionable error when top-level normalized format marker is missing", () => {
    const fixturePath = path.resolve(process.cwd(), "examples/simulations/tb.spice.h5");

    expect(() => loadNormalizedHdf5Dataset(fixturePath)).toThrowError(
      "Invalid normalized HDF5 file: expected file attribute 'format' to equal 'wave_viewer_hdf5'."
    );
  });

  it("throws an actionable error when /catalog/runs is missing", () => {
    const fixturePath = path.resolve(
      process.cwd(),
      "tests/fixtures/hdf5/normalized-missing-catalog-runs.h5"
    );

    expect(() => loadNormalizedHdf5Dataset(fixturePath)).toThrowError(
      "Invalid normalized HDF5 file: missing required dataset '/catalog/runs'."
    );
  });

  it("throws an actionable error when vectors column count and vector_names length differ", () => {
    const fixturePath = path.resolve(
      process.cwd(),
      "tests/fixtures/hdf5/normalized-mismatched-vectors.h5"
    );

    expect(() => loadNormalizedHdf5Dataset(fixturePath)).toThrowError(
      "Invalid normalized HDF5 file: '/runs/run-1/vector_names' length (1) must match '/runs/run-1/vectors' column count (2)."
    );
  });
});
