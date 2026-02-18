import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { loadNormalizedHdf5Dataset } from "../../../../src/core/hdf5/loadNormalizedHdf5";

describe("loadNormalizedHdf5Dataset", () => {
  it("loads single-run xyce_raw schema and maps it into Dataset with file path identity", () => {
    const fixturePath = path.resolve(process.cwd(), "examples/simulations/tb.spice.h5");

    const loaded = loadNormalizedHdf5Dataset(fixturePath);

    expect(loaded.dataset.path).toBe(fixturePath);
    expect(loaded.dataset.rowCount).toBe(251);
    expect(loaded.dataset.columns).toHaveLength(8);
    expect(loaded.dataset.columns[0]).toEqual({
      name: "sweep",
      values: expect.arrayContaining([0, 0.01, 0.02])
    });
  });

  it("throws when required '/indep_var' group is missing", () => {
    const fixturePath = path.resolve(process.cwd(), "tests/fixtures/hdf5/normalized-valid.h5");

    expect(() => loadNormalizedHdf5Dataset(fixturePath)).toThrowError("missing required dataset '/indep_var'.");
  });

  it("throws when vectors column count and vector_names length differ", () => {
    const fixturePath = path.resolve(
      process.cwd(),
      "tests/fixtures/hdf5/normalized-mismatched-vectors.h5"
    );

    expect(() => loadNormalizedHdf5Dataset(fixturePath)).toThrowError(
      "missing required dataset '/indep_var'."
    );
  });

  it("throws when required '/indep_var' group is missing for raw-derived files", () => {
    const fixturePath = path.resolve(process.cwd(), "examples/simulations/tb.spice.from_raw.h5");

    expect(() => loadNormalizedHdf5Dataset(fixturePath)).toThrowError(
      "missing required dataset '/indep_var'."
    );
  });
});
