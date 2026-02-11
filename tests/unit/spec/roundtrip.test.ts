import { describe, expect, it } from "vitest";

import { exportPlotSpecV1 } from "../../../src/core/spec/exportSpec";
import { importPlotSpecV1 } from "../../../src/core/spec/importSpec";
import type { WorkspaceState } from "../../../src/webview/state/workspaceState";

describe("T-006 spec roundtrip", () => {
  it("exports deterministic yaml and re-imports the same workspace fields", () => {
    const workspace: WorkspaceState = {
      activePlotId: "plot-2",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          xRange: [0, 10],
          axes: [
            { id: "y1", side: "left", title: "Vin", range: [-1, 1], scale: "linear" },
            { id: "y2", side: "right", title: "Vout", scale: "log" }
          ],
          traces: [
            {
              id: "trace-1",
              signal: "vin",
              axisId: "y1",
              visible: true,
              color: "#00aa00",
              lineWidth: 2
            },
            {
              id: "trace-2",
              signal: "vout",
              axisId: "y2",
              visible: false
            }
          ],
          nextAxisNumber: 3
        },
        {
          id: "plot-2",
          name: "Plot 2",
          xSignal: "freq",
          axes: [{ id: "y1", side: "left" }],
          traces: [],
          nextAxisNumber: 2
        }
      ]
    };

    const yaml = exportPlotSpecV1({
      datasetPath: "/workspace/examples/simulations/ota.spice.csv",
      workspace
    });

    const parsed = importPlotSpecV1({
      yamlText: yaml,
      availableSignals: ["time", "freq", "vin", "vout"]
    });

    expect(parsed.datasetPath).toBe("/workspace/examples/simulations/ota.spice.csv");
    expect(parsed.workspace).toEqual(workspace);

    const yamlAgain = exportPlotSpecV1({
      datasetPath: parsed.datasetPath,
      workspace: parsed.workspace
    });

    expect(yamlAgain).toBe(yaml);
  });
});
