import { describe, expect, it } from "vitest";

import { exportPlotSpecV1 } from "../../../../src/core/spec/exportSpec";
import type { WorkspaceState } from "../../../../src/webview/state/workspaceState";

const WORKSPACE: WorkspaceState = {
  activePlotId: "plot-1",
  plots: [
    {
      id: "plot-1",
      name: "Plot 1",
      xSignal: "time",
      axes: [{ id: "y1" }],
      traces: [],
      nextAxisNumber: 2
    }
  ]
};

describe("T-049 export spec path serialization", () => {
  it("writes relative dataset.path when layout and dataset are colocated", () => {
    const yamlText = exportPlotSpecV1({
      datasetPath: "/workspace/layouts/ota.spice.csv",
      workspace: WORKSPACE,
      specPath: "/workspace/layouts/lab.wave-viewer.yaml"
    });

    expect(yamlText).toContain("dataset:");
    expect(yamlText).toContain("path: ./ota.spice.csv");
  });

  it("writes portable relative dataset.path when layout is outside dataset folder", () => {
    const yamlText = exportPlotSpecV1({
      datasetPath: "/workspace/examples/simulations/ota.spice.csv",
      workspace: WORKSPACE,
      specPath: "/workspace/layouts/lab.wave-viewer.yaml"
    });

    expect(yamlText).toContain("path: ../examples/simulations/ota.spice.csv");
  });

  it("keeps absolute dataset.path when layout path is unknown", () => {
    const yamlText = exportPlotSpecV1({
      datasetPath: "/workspace/examples/simulations/ota.spice.csv",
      workspace: WORKSPACE
    });

    expect(yamlText).toContain("path: /workspace/examples/simulations/ota.spice.csv");
  });
});
