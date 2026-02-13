import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { importPlotSpecV1, readPlotSpecDatasetPathV1 } from "../../../../src/core/spec/importSpec";

function createSpecYaml(datasetPath: string): string {
  return [
    "version: 2",
    "datasets:",
    "  - id: run-a",
    `    path: ${datasetPath}`,
    "active_plot: plot-1",
    "active_dataset: run-a",
    "plots:",
    "  - id: plot-1",
    "    name: Plot 1",
    "    x:",
    "      dataset: run-a",
    "      signal: time",
    "    y:",
    "      - id: lane-main",
    "        signals:",
    "          trace-1:",
    "            dataset: run-a",
    "            signal: vin"
  ].join("\n");
}

describe("T-050 import spec v2 path resolution", () => {
  it("accepts v2 specs that omit mode", () => {
    const yamlText = createSpecYaml("/workspace/examples/simulations/ota.spice.csv");

    const parsed = importPlotSpecV1({
      yamlText,
      availableSignals: ["time", "vin"]
    });

    expect(parsed.workspace.activePlotId).toBe("plot-1");
    expect(parsed.workspace.plots).toHaveLength(1);
    expect(parsed.workspace.plots[0]?.traces).toEqual([
      {
        id: "trace-1",
        signal: "vin",
        sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
        axisId: "y1",
        visible: true
      }
    ]);
  });

  it("resolves relative dataset.path against layout file location", () => {
    const layoutPath = path.resolve("/workspace/layouts/lab.wave-viewer.yaml");
    const yamlText = createSpecYaml("../examples/simulations/ota.spice.csv");

    const parsed = importPlotSpecV1({
      yamlText,
      availableSignals: ["time", "vin"],
      specPath: layoutPath
    });

    expect(parsed.datasetPath).toBe(path.resolve("/workspace/examples/simulations/ota.spice.csv"));
  });

  it("rejects relative dataset.path when specPath context is missing", () => {
    const yamlText = createSpecYaml("../examples/simulations/ota.spice.csv");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["time", "vin"]
      })
    ).toThrow("Plot spec dataset.path is relative but no spec file path was provided for resolution.");
  });

  it("resolves dataset path from read helper with spec path context", () => {
    const layoutPath = path.resolve("/workspace/layouts/lab.wave-viewer.yaml");
    const yamlText = createSpecYaml("./ota.spice.csv");

    expect(readPlotSpecDatasetPathV1(yamlText, layoutPath)).toBe(
      path.resolve("/workspace/layouts/ota.spice.csv")
    );
  });

  it("rejects unsupported v1 specs", () => {
    const yamlText = [
      "version: 1",
      "datasets: []",
      "active_dataset: run-a",
      "active_plot: plot-1",
      "plots: []"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["time"]
      })
    ).toThrow("Unsupported plot spec version: 1. Supported version is 2.");
  });

  it("rejects v2 specs that include mode", () => {
    const yamlText = [
      "version: 2",
      "mode: portable",
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
      "      signal: time",
      "    y:",
      "      - id: lane-main",
      "        signals: {}"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["time"]
      })
    ).toThrow("Plot spec mode is not supported in v2 layout schema.");
  });

  it("rejects legacy single-dataset v2 payloads", () => {
    const yamlText = [
      "version: 2",
      "dataset:",
      "  path: /workspace/examples/simulations/ota.spice.csv",
      "active_plot: plot-1",
      "plots:",
      "  - id: plot-1",
      "    name: Plot 1",
      "    x:",
      "      signal: time",
      "    y:",
      "      - id: lane-main",
      "        signals:",
      "          trace-1: vin"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["time", "vin"]
      })
    ).toThrow("Plot spec datasets must be a non-empty array.");
  });
});
