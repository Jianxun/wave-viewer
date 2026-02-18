import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  importPlotSpecV1,
  readPlotSpecDatasetPathV1,
  readPlotSpecDatasetsV1
} from "../../../../src/core/spec/importSpec";

function createSpecYaml(datasetPath: string): string {
  return [
    "version: 3",
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
    "      signal:",
    "        base: time",
    "    y:",
    "      - id: lane-main",
    "        signals:",
    "          trace-1:",
    "            dataset: run-a",
    "            signal:",
    "              base: vin"
  ].join("\n");
}

describe("T-067 import spec v3 path resolution", () => {
  it("accepts v3 specs and reconstructs runtime trace identity", () => {
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
    expect(parsed.xDatasetPathByPlotId).toEqual({
      "plot-1": "/workspace/examples/simulations/ota.spice.csv"
    });
  });

  it("roundtrips accessor-bearing y traces into runtime `<base>.<accessor>` signals", () => {
    const yamlText = [
      "version: 3",
      "datasets:",
      "  - id: run-a",
      "    path: /workspace/examples/simulations/tb.spice.h5",
      "active_plot: plot-1",
      "active_dataset: run-a",
      "plots:",
      "  - id: plot-1",
      "    name: AC",
      "    x:",
      "      dataset: run-a",
      "      signal:",
      "        base: FREQ",
      "    y:",
      "      - id: lane-mag",
      "        signals:",
      "          vout-db:",
      "            dataset: run-a",
      "            signal:",
      "              base: XOTA/V(OUT)",
      "              accessor: db20"
    ].join("\n");

    const parsed = importPlotSpecV1({
      yamlText,
      availableSignals: ["FREQ", "XOTA/V(OUT).db20"]
    });

    expect(parsed.workspace.plots[0]?.traces).toEqual([
      {
        id: "vout-db",
        signal: "XOTA/V(OUT).db20",
        sourceId: "/workspace/examples/simulations/tb.spice.h5::XOTA/V(OUT).db20",
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

  it("reads all dataset references for dataset-qualified signal validation", () => {
    const layoutPath = path.resolve("/workspace/layouts/lab.wave-viewer.yaml");
    const yamlText = [
      "version: 3",
      "datasets:",
      "  - id: run-a",
      "    path: ../examples/run-a.csv",
      "  - id: run-b",
      "    path: ../examples/run-b.csv",
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
      "          trace-b:",
      "            dataset: run-b",
      "            signal:",
      "              base: ib"
    ].join("\n");

    expect(readPlotSpecDatasetsV1(yamlText, layoutPath)).toEqual([
      { id: "run-a", path: path.resolve("/workspace/examples/run-a.csv") },
      { id: "run-b", path: path.resolve("/workspace/examples/run-b.csv") }
    ]);
  });

  it("rejects unsupported v2 specs", () => {
    const yamlText = [
      "version: 2",
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
    ).toThrow("Unsupported plot spec version: 2. Supported version is 3.");
  });

  it("rejects v3 specs that include mode", () => {
    const yamlText = [
      "version: 3",
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
    ).toThrow("Plot spec mode is not supported in v3 layout schema.");
  });

  it("keeps per-plot x.dataset identity for export replay", () => {
    const yamlText = [
      "version: 3",
      "datasets:",
      "  - id: run-a",
      "    path: /workspace/examples/run-a.csv",
      "  - id: run-b",
      "    path: /workspace/examples/run-b.csv",
      "active_dataset: run-a",
      "active_plot: plot-1",
      "plots:",
      "  - id: plot-1",
      "    name: Plot 1",
      "    x:",
      "      dataset: run-b",
      "      signal:",
      "        base: time",
      "    y:",
      "      - id: lane-main",
      "        signals:",
      "          trace-a:",
      "            dataset: run-a",
      "            signal:",
      "              base: vin"
    ].join("\n");

    const parsed = importPlotSpecV1({
      yamlText,
      availableSignals: {
        "run-a": ["vin"],
        "run-b": ["time"]
      }
    });

    expect(parsed.datasetPath).toBe("/workspace/examples/run-a.csv");
    expect(parsed.xDatasetPathByPlotId).toEqual({
      "plot-1": "/workspace/examples/run-b.csv"
    });
  });

  it("validates signals against dataset-specific availability maps", () => {
    const yamlText = [
      "version: 3",
      "datasets:",
      "  - id: run-a",
      "    path: /workspace/examples/run-a.csv",
      "  - id: run-b",
      "    path: /workspace/examples/run-b.csv",
      "active_dataset: run-a",
      "active_plot: plot-1",
      "plots:",
      "  - id: plot-1",
      "    name: Plot 1",
      "    x:",
      "      dataset: run-b",
      "      signal:",
      "        base: time_b",
      "    y:",
      "      - id: lane-main",
      "        signals:",
      "          trace-a:",
      "            dataset: run-a",
      "            signal:",
      "              base: vin_a",
      "          trace-b:",
      "            dataset: run-b",
      "            signal:",
      "              base: vin_b"
    ].join("\n");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: {
          "run-a": ["vin_a"],
          "run-b": ["time_b", "vin_b"]
        }
      })
    ).not.toThrow();
  });
});
