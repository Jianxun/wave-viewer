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
      traces: [{ id: "trace-vin", signal: "vin", axisId: "y1", visible: true }],
      nextAxisNumber: 2
    }
  ]
};

describe("T-050 export spec v2 path serialization", () => {
  it("writes relative dataset.path when layout and dataset are colocated", () => {
    const yamlText = exportPlotSpecV1({
      datasetPath: "/workspace/layouts/ota.spice.csv",
      workspace: WORKSPACE,
      specPath: "/workspace/layouts/lab.wave-viewer.yaml"
    });

    expect(yamlText).toContain("version: 2");
    expect(yamlText).toContain("active_plot: plot-1");
    expect(yamlText).toContain("active_dataset: dataset-1");
    expect(yamlText).toContain("datasets:");
    expect(yamlText).toContain("id: dataset-1");
    expect(yamlText).toContain("path: ./ota.spice.csv");
    expect(yamlText).not.toContain("mode:");
    expect(yamlText).toContain("dataset: dataset-1");
    expect(yamlText).toContain("y:");
    expect(yamlText).toContain("signal: vin");
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

  it("keeps absolute dataset.path for windows cross-drive layout and dataset", () => {
    const yamlText = exportPlotSpecV1({
      datasetPath: "D:\\data\\ota.spice.csv",
      workspace: WORKSPACE,
      specPath: "C:\\layouts\\lab.wave-viewer.yaml"
    });

    expect(yamlText).toContain("path: D:/data/ota.spice.csv");
    expect(yamlText).not.toContain("path: ./D:/data/ota.spice.csv");
  });

  it("emits additional datasets inferred from trace source ids", () => {
    const yamlText = exportPlotSpecV1({
      datasetPath: "/workspace/examples/run-a.csv",
      workspace: {
        activePlotId: "plot-1",
        plots: [
          {
            id: "plot-1",
            name: "Plot 1",
            xSignal: "time",
            axes: [{ id: "y1" }],
            traces: [
              {
                id: "trace-run-b",
                signal: "vin",
                sourceId: "/workspace/examples/run-b.csv::vin",
                axisId: "y1",
                visible: true
              }
            ],
            nextAxisNumber: 2
          }
        ]
      }
    });

    expect(yamlText).toContain("id: dataset-1");
    expect(yamlText).toContain("path: /workspace/examples/run-a.csv");
    expect(yamlText).toContain("id: dataset-2");
    expect(yamlText).toContain("path: /workspace/examples/run-b.csv");
    expect(yamlText).toContain("trace-run-b:");
    expect(yamlText).toContain("dataset: dataset-2");
    expect(yamlText).toContain("signal: vin");
  });
});
