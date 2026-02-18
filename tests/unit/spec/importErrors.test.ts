import { describe, expect, it } from "vitest";

import { importPlotSpecV1 } from "../../../src/core/spec/importSpec";

describe("T-067 spec import errors", () => {
  it("rejects non-v3 layouts with actionable version guidance", () => {
    const yamlText = [
      "version: 2",
      "datasets:",
      "  - id: run-a",
      "    path: /workspace/examples/simulations/ota.spice.csv",
      "active_dataset: run-a",
      "active_plot: plot-1",
      "plots: []"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["time", "vin"]
      })
    ).toThrow("Unsupported plot spec version: 2. Supported version is 3.");
  });

  it("rejects deprecated mode in v3 layouts", () => {
    const yamlText = [
      "version: 3",
      "mode: reference-only",
      "datasets:",
      "  - id: run-a",
      "    path: /workspace/examples/simulations/ota.spice.csv",
      "active_dataset: run-a",
      "active_plot: plot-1",
      "plots: []"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["time", "vin"]
      })
    ).toThrow("Plot spec mode is not supported in v3 layout schema.");
  });

  it("throws explicit error for missing plots", () => {
    const yamlText = [
      "version: 3",
      "datasets:",
      "  - id: run-a",
      "    path: /workspace/examples/simulations/ota.spice.csv",
      "active_dataset: run-a",
      "active_plot: plot-1",
      "plots: []"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["time", "vin"]
      })
    ).toThrow("Plot spec must include at least one plot in plots.");
  });

  it("throws explicit error for missing signal references by plot", () => {
    const yamlText = [
      "version: 3",
      "datasets:",
      "  - id: run-a",
      "    path: /workspace/examples/simulations/ota.spice.csv",
      "active_dataset: run-a",
      "active_plot: plot-1",
      "plots:",
      "  - id: plot-1",
      "    name: Plot 1",
      "    x:",
      "      dataset: run-a",
      "      signal:",
      "        base: time",
      "    y:",
      "      - id: lane-main",
      "        signals:",
      "          trace-1:",
      "            dataset: run-a",
      "            signal:",
      "              base: vin",
      "          trace-2:",
      "            dataset: run-a",
      "            signal:",
      "              base: unknownSignal"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["vin"]
      })
    ).toThrow(
      "Missing signals in plot spec: plot plot-1 (x.run-a: time; y.lane-main.run-a: unknownSignal)."
    );
  });

  it("throws explicit error when active plot id is not present", () => {
    const yamlText = [
      "version: 3",
      "datasets:",
      "  - id: run-a",
      "    path: /workspace/examples/simulations/ota.spice.csv",
      "active_dataset: run-a",
      "active_plot: plot-missing",
      "plots:",
      "  - id: plot-1",
      "    name: Plot 1",
      "    x:",
      "      dataset: run-a",
      "      signal:",
      "        base: time",
      "    y:",
      "      - id: lane-main",
      "        signals: {}"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["time"]
      })
    ).toThrow("Active plot id plot-missing is missing from plots.");
  });

  it("rejects x.signal accessor refs with a migration error", () => {
    const yamlText = [
      "version: 3",
      "datasets:",
      "  - id: run-a",
      "    path: /workspace/examples/tb.spice.h5",
      "active_dataset: run-a",
      "active_plot: plot-1",
      "plots:",
      "  - id: plot-1",
      "    name: AC",
      "    x:",
      "      dataset: run-a",
      "      signal:",
      "        base: FREQ",
      "        accessor: db20",
      "    y:",
      "      - id: lane-main",
      "        signals: {}"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["FREQ"]
      })
    ).toThrow("Plot plot-1 x.signal.accessor is not allowed for x.signal.");
  });

  it("rejects invalid x.scale values with actionable guidance", () => {
    const yamlText = [
      "version: 3",
      "datasets:",
      "  - id: run-a",
      "    path: /workspace/examples/simulations/ota.spice.csv",
      "active_dataset: run-a",
      "active_plot: plot-1",
      "plots:",
      "  - id: plot-1",
      "    name: Plot 1",
      "    x:",
      "      dataset: run-a",
      "      signal:",
      "        base: time",
      "      scale: ln",
      "    y:",
      "      - id: lane-main",
      "        signals: {}"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["time"]
      })
    ).toThrow("Plot plot-1 x.scale must be 'linear' or 'log' when provided.");
  });
});
