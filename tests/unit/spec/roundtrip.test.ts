import { describe, expect, it } from "vitest";

import { exportPlotSpecV1 } from "../../../src/core/spec/exportSpec";
import { importPlotSpecV1 } from "../../../src/core/spec/importSpec";
import type { WorkspaceState } from "../../../src/webview/state/workspaceState";

describe("T-067 spec roundtrip", () => {
  it("exports deterministic v3 yaml and re-imports the same workspace fields", () => {
    const workspace: WorkspaceState = {
      activePlotId: "plot-2",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          xRange: [0, 10],
          axes: [
            { id: "y1", title: "Vin", range: [-1, 1], scale: "linear" },
            { id: "y2", title: "Vout", scale: "log" }
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
          axes: [{ id: "y1" }],
          traces: [],
          nextAxisNumber: 2
        }
      ]
    };

    const yaml = exportPlotSpecV1({
      datasetPath: "/workspace/examples/simulations/ota.spice.csv",
      workspace
    });
    expect(yaml).toContain("version: 3");
    expect(yaml).not.toContain("mode:");

    const parsed = importPlotSpecV1({
      yamlText: yaml,
      availableSignals: ["time", "freq", "vin", "vout"]
    });

    expect(parsed.datasetPath).toBe("/workspace/examples/simulations/ota.spice.csv");
    expect(parsed.workspace).toEqual({
      activePlotId: "plot-2",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          xRange: [0, 10],
          axes: [
            { id: "y1", title: "Vin", range: [-1, 1], scale: "linear" },
            { id: "y2", title: "Vout", scale: "log" }
          ],
          traces: [
            {
              id: "trace-1",
              signal: "vin",
              sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
              axisId: "y1",
              visible: true
            },
            {
              id: "trace-2",
              signal: "vout",
              sourceId: "/workspace/examples/simulations/ota.spice.csv::vout",
              axisId: "y2",
              visible: true
            }
          ],
          nextAxisNumber: 3
        },
        {
          id: "plot-2",
          name: "Plot 2",
          xSignal: "freq",
          axes: [{ id: "y1" }],
          traces: [],
          nextAxisNumber: 2
        }
      ]
    });

    const yamlAgain = exportPlotSpecV1({
      datasetPath: parsed.datasetPath,
      workspace: parsed.workspace
    });

    expect(yamlAgain).toBe(yaml);
  });

  it("roundtrips accessor-bearing traces with structured signal refs", () => {
    const workspace: WorkspaceState = {
      activePlotId: "plot-1",
      plots: [
        {
          id: "plot-1",
          name: "AC",
          xSignal: "FREQ",
          axes: [{ id: "y1", title: "Magnitude" }],
          traces: [
            {
              id: "trace-mag",
              signal: "XOTA/V(OUT).db20",
              sourceId: "/workspace/examples/tb.spice.h5::XOTA/V(OUT).db20",
              axisId: "y1",
              visible: true
            }
          ],
          nextAxisNumber: 2
        }
      ]
    };

    const yaml = exportPlotSpecV1({
      datasetPath: "/workspace/examples/tb.spice.h5",
      workspace
    });

    expect(yaml).toContain("base: XOTA/V(OUT)");
    expect(yaml).toContain("accessor: db20");

    const parsed = importPlotSpecV1({
      yamlText: yaml,
      availableSignals: ["FREQ", "XOTA/V(OUT).db20"]
    });

    expect(parsed.workspace).toEqual({
      activePlotId: "plot-1",
      plots: [
        {
          id: "plot-1",
          name: "AC",
          xSignal: "FREQ",
          axes: [{ id: "y1", title: "Magnitude" }],
          traces: [
            {
              id: "trace-mag",
              signal: "XOTA/V(OUT).db20",
              sourceId: "/workspace/examples/tb.spice.h5::XOTA/V(OUT).db20",
              axisId: "y1",
              visible: true
            }
          ],
          nextAxisNumber: 2
        }
      ]
    });
  });

  it("preserves lane-order axes through export/import replay", () => {
    const workspace: WorkspaceState = {
      activePlotId: "plot-1",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          axes: [{ id: "y2", title: "Top lane" }, { id: "y1", title: "Bottom lane" }],
          traces: [
            { id: "trace-1", signal: "vin", axisId: "y2", visible: true },
            { id: "trace-2", signal: "vout", axisId: "y1", visible: true }
          ],
          nextAxisNumber: 3
        }
      ]
    };

    const yaml = exportPlotSpecV1({
      datasetPath: "/workspace/examples/simulations/ota.spice.csv",
      workspace
    });
    const parsed = importPlotSpecV1({
      yamlText: yaml,
      availableSignals: ["time", "vin", "vout"]
    });

    expect(yaml).toContain("- id: lane-1");
    expect(yaml).toContain("- id: lane-2");
    expect(parsed.workspace).toEqual({
      activePlotId: "plot-1",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          axes: [{ id: "y1", title: "Top lane" }, { id: "y2", title: "Bottom lane" }],
          traces: [
            {
              id: "trace-1",
              signal: "vin",
              sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
              axisId: "y1",
              visible: true
            },
            {
              id: "trace-2",
              signal: "vout",
              sourceId: "/workspace/examples/simulations/ota.spice.csv::vout",
              axisId: "y2",
              visible: true
            }
          ],
          nextAxisNumber: 3
        }
      ]
    });
  });
});
