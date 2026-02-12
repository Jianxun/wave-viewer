import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { importPlotSpecV1, readPlotSpecDatasetPathV1 } from "../../../../src/core/spec/importSpec";

function createSpecYaml(datasetPath: string): string {
  return [
    "version: 1",
    "mode: reference-only",
    "dataset:",
    `  path: ${datasetPath}`,
    "workspace:",
    "  activePlotId: plot-1",
    "  plots:",
    "    - id: plot-1",
    "      name: Plot 1",
    "      xSignal: time",
    "      axes:",
    "        - id: y1",
    "      traces: []"
  ].join("\n");
}

describe("T-049 import spec path resolution", () => {
  it("resolves relative dataset.path against layout file location", () => {
    const layoutPath = path.resolve("/workspace/layouts/lab.wave-viewer.yaml");
    const yamlText = createSpecYaml("../examples/simulations/ota.spice.csv");

    const parsed = importPlotSpecV1({
      yamlText,
      availableSignals: ["time"],
      specPath: layoutPath
    });

    expect(parsed.datasetPath).toBe(path.resolve("/workspace/examples/simulations/ota.spice.csv"));
  });

  it("rejects relative dataset.path when specPath context is missing", () => {
    const yamlText = createSpecYaml("../examples/simulations/ota.spice.csv");

    expect(() =>
      importPlotSpecV1({
        yamlText,
        availableSignals: ["time"]
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
});
