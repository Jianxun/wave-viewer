import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { parseCsv } from "../../src/core/csv/parseCsv";
import { selectDefaultX } from "../../src/core/dataset/selectDefaultX";
import { exportPlotSpecV1 } from "../../src/core/spec/exportSpec";
import { importPlotSpecV1 } from "../../src/core/spec/importSpec";
import { reduceWorkspaceState } from "../../src/webview/state/reducer";
import { createWorkspaceState, type WorkspaceState } from "../../src/webview/state/workspaceState";

function createExploredWorkspace(defaultXSignal: string): WorkspaceState {
  let workspace = createWorkspaceState(defaultXSignal);

  workspace = reduceWorkspaceState(workspace, {
    type: "axis/add",
    payload: { side: "right" }
  });
  workspace = reduceWorkspaceState(workspace, {
    type: "trace/add",
    payload: { signal: "V(OUT)", axisId: "y1" }
  });
  workspace = reduceWorkspaceState(workspace, {
    type: "trace/add",
    payload: { signal: "V(OUT)", axisId: "y2" }
  });
  workspace = reduceWorkspaceState(workspace, {
    type: "trace/add",
    payload: { signal: "V(IN)", axisId: "y2" }
  });

  workspace = reduceWorkspaceState(workspace, {
    type: "plot/add",
    payload: { xSignal: "V(IN)", name: "Plot 2 - OTA internals" }
  });
  workspace = reduceWorkspaceState(workspace, {
    type: "axis/add",
    payload: { side: "right" }
  });
  workspace = reduceWorkspaceState(workspace, {
    type: "trace/add",
    payload: { signal: "V(XOTA:D)", axisId: "y1" }
  });
  workspace = reduceWorkspaceState(workspace, {
    type: "trace/add",
    payload: { signal: "V(XOTA:TAIL)", axisId: "y2" }
  });

  return reduceWorkspaceState(workspace, {
    type: "plot/setActive",
    payload: { plotId: "plot-2" }
  });
}

describe("T-007 e2e replay smoke", () => {
  it("replays ota.spice.csv workspace with two tabs and multi-axis traces", () => {
    const csvPath = path.resolve(process.cwd(), "examples/simulations/ota.spice.csv");
    const csvText = fs.readFileSync(csvPath, "utf8");
    const dataset = parseCsv({ path: csvPath, csvText });
    const defaultXSignal = selectDefaultX(dataset);
    const workspace = createExploredWorkspace(defaultXSignal);
    const availableSignals = dataset.columns.map((column) => column.name);

    expect(dataset.rowCount).toBeGreaterThan(1);
    expect(defaultXSignal).toBe("V(VBN)");
    expect(workspace.plots).toHaveLength(2);
    expect(workspace.plots[0]?.axes.map((axis) => axis.id)).toEqual(["y1", "y2"]);
    expect(workspace.plots[0]?.traces.map((trace) => `${trace.signal}@${trace.axisId}`)).toEqual([
      "V(OUT)@y1",
      "V(OUT)@y2",
      "V(IN)@y2"
    ]);

    const yaml = exportPlotSpecV1({
      datasetPath: dataset.path,
      workspace
    });
    const replay = importPlotSpecV1({
      yamlText: yaml,
      availableSignals
    });

    expect(replay.datasetPath).toBe(dataset.path);
    expect(replay.workspace).toEqual(workspace);
  });
});
