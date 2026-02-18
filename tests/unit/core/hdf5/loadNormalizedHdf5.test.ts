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
    expect(loaded.dataset.columns.map((column) => column.name)).toEqual([
      "sweep",
      "V(IN)",
      "V(OUT)",
      "V(VBN)",
      "V(VDD)",
      "V(VSS)",
      "XOTA/V(D)",
      "XOTA/V(TAIL)"
    ]);
    expect(loaded.signalPaths).toEqual([
      "V(IN)",
      "V(OUT)",
      "V(VBN)",
      "V(VDD)",
      "V(VSS)",
      "XOTA/V(D)",
      "XOTA/V(TAIL)"
    ]);
    expect(loaded.signalAliasLookup).toMatchObject({
      "V(XOTA:D)": "XOTA/V(D)",
      "V(XOTA:TAIL)": "XOTA/V(TAIL)"
    });
    expect(loaded.complexSignalPaths).toEqual([]);
    expect(loaded.resolveSignalValues("V(OUT)")).toEqual(
      expect.arrayContaining([0.15872853649408739, 0.15897780435386807, 0.1593058666929687])
    );
    expect(loaded.dataset.columns[0]).toEqual({
      name: "sweep",
      values: expect.arrayContaining([0, 0.01, 0.02])
    });
  });

  it("loads mixed scalar/complex vectors and lazily projects accessor traces", () => {
    const fixturePath = path.resolve(
      process.cwd(),
      "tests/fixtures/hdf5/normalized-mixed-real-complex.h5"
    );

    const loaded = loadNormalizedHdf5Dataset(fixturePath);

    expect(loaded.dataset.columns).toEqual([
      {
        name: "freq",
        values: [1, 2, 5, 10]
      },
      {
        name: "V(OUT)",
        values: [0.5, 0.6, 0.7, 0.8]
      }
    ]);
    expect(loaded.signalPaths).toEqual(["V(IN)", "V(OUT)"]);
    expect(loaded.signalAliasLookup).toEqual({
      "V(IN_ALIAS)": "V(IN)"
    });
    expect(loaded.complexSignalPaths).toEqual(["V(IN)"]);

    expect(loaded.resolveSignalValues("V(OUT)")).toEqual([0.5, 0.6, 0.7, 0.8]);
    expect(loaded.resolveSignalValues("V(IN).re")).toEqual([1, 0, 3, -1]);
    expect(loaded.resolveSignalValues("V(IN).im")).toEqual([0, 2, 4, 1]);

    const mag = loaded.resolveSignalValues("V(IN).mag");
    expect(mag).toHaveLength(4);
    expect(mag?.[0]).toBeCloseTo(1);
    expect(mag?.[1]).toBeCloseTo(2);
    expect(mag?.[2]).toBeCloseTo(5);
    expect(mag?.[3]).toBeCloseTo(Math.sqrt(2));

    const phase = loaded.resolveSignalValues("V(IN).phase");
    expect(phase).toHaveLength(4);
    expect(phase?.[0]).toBeCloseTo(0);
    expect(phase?.[1]).toBeCloseTo(90);
    expect(phase?.[2]).toBeCloseTo(53.13010235415598);
    expect(phase?.[3]).toBeCloseTo(135);

    const db20 = loaded.resolveSignalValues("V(IN).db20");
    expect(db20).toHaveLength(4);
    expect(db20?.[0]).toBeCloseTo(0);
    expect(db20?.[1]).toBeCloseTo(6.020599913279624);
    expect(db20?.[2]).toBeCloseTo(13.979400086720377);
    expect(db20?.[3]).toBeCloseTo(3.010299956639812);

    expect(() => loaded.resolveSignalValues("V(IN)")).toThrowError(
      "Cannot project complex signal 'V(IN)' without accessor."
    );
    expect(() => loaded.resolveSignalValues("V(OUT).db20")).toThrowError(
      "Signal 'V(OUT)' is real-valued and does not support accessor '.db20'."
    );
  });

  it("uses real-part independent variable values when frequency is complex-encoded with negligible imag", () => {
    const fixturePath = path.resolve(process.cwd(), "examples/simulations/tb.spice.ac.h5");

    const loaded = loadNormalizedHdf5Dataset(fixturePath);

    expect(loaded.dataset.columns[0]?.name).toBe("FREQUENCY");
    expect(loaded.dataset.columns[0]?.values[0]).toBeCloseTo(1);
    expect(loaded.dataset.columns[0]?.values[1]).toBeCloseTo(1.023292992280754);
    expect(loaded.complexSignalPaths).toContain("V(OUT)");
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
