import { describe, expect, it } from "vitest";

import { importPlotSpecV1 } from "../../../src/core/spec/importSpec";

describe("T-006 spec import errors", () => {
  it("throws explicit error for missing plots", () => {
    const yamlText = [
      "version: 1",
      "dataset:",
      "  path: /workspace/examples/simulations/ota.spice.csv",
      "workspace:",
      "  activePlotId: plot-1",
      "  plots: []"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["time", "vin"]
      })
    ).toThrow("Plot spec must include at least one plot in workspace.plots.");
  });

  it("throws explicit error for missing signal references by plot", () => {
    const yamlText = [
      "version: 1",
      "dataset:",
      "  path: /workspace/examples/simulations/ota.spice.csv",
      "workspace:",
      "  activePlotId: plot-1",
      "  plots:",
      "    - id: plot-1",
      "      name: Plot 1",
      "      xSignal: time",
      "      axes:",
      "        - id: y1",
      "      traces:",
      "        - id: trace-1",
      "          signal: vin",
      "          axisId: y1",
      "          visible: true",
      "        - id: trace-2",
      "          signal: unknownSignal",
      "          axisId: y1",
      "          visible: true"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["vin"]
      })
    ).toThrow(
      "Missing signals in plot spec: plot plot-1 (xSignal: time; traces: unknownSignal)."
    );
  });

  it("throws explicit error when active plot id is not present", () => {
    const yamlText = [
      "version: 1",
      "dataset:",
      "  path: /workspace/examples/simulations/ota.spice.csv",
      "workspace:",
      "  activePlotId: plot-missing",
      "  plots:",
      "    - id: plot-1",
      "      name: Plot 1",
      "      xSignal: time",
      "      axes:",
      "        - id: y1",
      "      traces: []"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["time"]
      })
    ).toThrow("Active plot id plot-missing is missing from workspace.plots.");
  });

  it("rejects legacy axis side fields with a migration error", () => {
    const yamlText = [
      "version: 1",
      "dataset:",
      "  path: /workspace/examples/simulations/ota.spice.csv",
      "workspace:",
      "  activePlotId: plot-1",
      "  plots:",
      "    - id: plot-1",
      "      name: Plot 1",
      "      xSignal: time",
      "      axes:",
      "        - id: y1",
      "          side: left",
      "      traces: []"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["time"]
      })
    ).toThrow(
      "Plot plot-1 axis y1 uses legacy field side. Re-export this workspace with the current Wave Viewer version."
    );
  });
});
