import { describe, expect, it } from "vitest";

import { exportPlotSpecV1 } from "../../../src/core/spec/exportSpec";
import { importPlotSpecV1 } from "../../../src/core/spec/importSpec";
import { PORTABLE_ARCHIVE_SPEC_MODE } from "../../../src/core/spec/plotSpecV1";
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
    expect(yaml).toContain("mode: reference-only");

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

  it("does not serialize legacy side fields", () => {
    const workspace: WorkspaceState = {
      activePlotId: "plot-1",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          axes: [{ id: "y1", title: "Lane 1" }, { id: "y2", scale: "log" }],
          traces: [
            { id: "trace-1", signal: "vin", axisId: "y1", visible: true },
            { id: "trace-2", signal: "vout", axisId: "y2", visible: true }
          ],
          nextAxisNumber: 3
        }
      ]
    };

    const yaml = exportPlotSpecV1({
      datasetPath: "/workspace/examples/simulations/ota.spice.csv",
      workspace
    });

    expect(yaml).not.toContain("side:");
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

    expect(yaml).toContain("id: y2");
    expect(yaml).toContain("id: y1");
    expect(parsed.workspace).toEqual(workspace);
  });

  it("exports deterministic portable-archive yaml and re-imports embedded tuples", () => {
    const workspace: WorkspaceState = {
      activePlotId: "plot-1",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          axes: [{ id: "y1" }, { id: "y2" }],
          traces: [
            {
              id: "trace-1",
              signal: "vin",
              sourceId: "/workspace/examples/simulations/source-a.csv::vin",
              axisId: "y1",
              visible: true
            },
            {
              id: "trace-2",
              signal: "vout",
              sourceId: "/workspace/examples/simulations/source-b.csv::vout",
              axisId: "y2",
              visible: true
            }
          ],
          nextAxisNumber: 3
        }
      ]
    };

    const tupleBySourceId = new Map([
      [
        "/workspace/examples/simulations/source-a.csv::vin",
        {
          sourceId: "/workspace/examples/simulations/source-a.csv::vin",
          datasetPath: "/workspace/examples/simulations/source-a.csv",
          xName: "time",
          yName: "vin",
          x: [0, 1, 2],
          y: [0.1, 0.2, 0.3]
        }
      ],
      [
        "/workspace/examples/simulations/source-b.csv::vout",
        {
          sourceId: "/workspace/examples/simulations/source-b.csv::vout",
          datasetPath: "/workspace/examples/simulations/source-b.csv",
          xName: "time",
          yName: "vout",
          x: [0, 1, 2],
          y: [1.1, 1.2, 1.3]
        }
      ]
    ]);

    const yaml = exportPlotSpecV1({
      mode: PORTABLE_ARCHIVE_SPEC_MODE,
      datasetPath: "/workspace/examples/simulations/active.csv",
      workspace,
      traceTupleBySourceId: tupleBySourceId
    });

    expect(yaml).toContain("mode: portable-archive");
    expect(yaml).toContain("archive:");
    expect(yaml).toContain("sourceId: /workspace/examples/simulations/source-a.csv::vin");
    expect(yaml).toContain("sourceId: /workspace/examples/simulations/source-b.csv::vout");

    const parsed = importPlotSpecV1({
      yamlText: yaml,
      availableSignals: []
    });

    expect(parsed.mode).toBe(PORTABLE_ARCHIVE_SPEC_MODE);
    expect(parsed.workspace).toEqual(workspace);
    expect(parsed.traceTupleBySourceId).toEqual(tupleBySourceId);

    const yamlAgain = exportPlotSpecV1({
      mode: PORTABLE_ARCHIVE_SPEC_MODE,
      datasetPath: parsed.datasetPath,
      workspace: parsed.workspace,
      traceTupleBySourceId: parsed.traceTupleBySourceId
    });
    expect(yamlAgain).toBe(yaml);
  });
});
