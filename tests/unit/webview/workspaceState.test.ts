import { describe, expect, it } from "vitest";

import {
  addAxis,
  addPlot,
  addTrace,
  createWorkspaceState,
  removeAxis,
  removePlot,
  renamePlot,
  reassignAxisTraces,
  setActivePlot
} from "../../../src/webview/state/workspaceState";
import { reduceWorkspaceState, type WorkspaceAction } from "../../../src/webview/state/reducer";

describe("workspaceState", () => {
  it("creates a workspace with one active plot and y1 axis", () => {
    const workspace = createWorkspaceState("time");
    expect(workspace.activePlotId).toBe("plot-1");
    expect(workspace.plots).toHaveLength(1);
    expect(workspace.plots[0]).toMatchObject({
      id: "plot-1",
      name: "Plot 1",
      xSignal: "time"
    });
    expect(workspace.plots[0]?.axes).toEqual([{ id: "y1", side: "left" }]);
    expect(workspace.plots[0]?.traces).toEqual([]);
  });

  it("supports add/rename/remove/switch tabs", () => {
    let workspace = createWorkspaceState("time");
    workspace = addPlot(workspace, { xSignal: "vin" });
    const secondPlotId = workspace.activePlotId;

    expect(workspace.plots).toHaveLength(2);
    expect(workspace.plots[1]?.xSignal).toBe("vin");

    workspace = renamePlot(workspace, { plotId: secondPlotId, name: "Scope A" });
    expect(workspace.plots[1]?.name).toBe("Scope A");

    workspace = setActivePlot(workspace, { plotId: "plot-1" });
    expect(workspace.activePlotId).toBe("plot-1");

    workspace = removePlot(workspace, { plotId: secondPlotId });
    expect(workspace.plots).toHaveLength(1);
    expect(workspace.activePlotId).toBe("plot-1");
  });

  it("adds trace instances to explicit axes and supports duplicate signals", () => {
    let workspace = createWorkspaceState("time");
    workspace = addAxis(workspace, {});
    workspace = addTrace(workspace, { signal: "vin", axisId: "y1" });
    workspace = addTrace(workspace, { signal: "vin", axisId: "y2" });

    const traces = workspace.plots[0]?.traces ?? [];
    expect(traces).toHaveLength(2);
    expect(traces[0]).toMatchObject({ signal: "vin", axisId: "y1", visible: true });
    expect(traces[1]).toMatchObject({ signal: "vin", axisId: "y2", visible: true });
  });

  it("blocks axis removal when traces still reference the axis", () => {
    let workspace = createWorkspaceState("time");
    workspace = addAxis(workspace, {});
    workspace = addTrace(workspace, { signal: "vout", axisId: "y2" });

    expect(() => removeAxis(workspace, { axisId: "y2" })).toThrow(
      "Cannot remove axis y2 because traces are still assigned."
    );
  });

  it("supports axis removal with reassignment", () => {
    let workspace = createWorkspaceState("time");
    workspace = addAxis(workspace, {});
    workspace = addTrace(workspace, { signal: "vout", axisId: "y2" });

    workspace = removeAxis(workspace, { axisId: "y2", reassignToAxisId: "y1" });

    const plot = workspace.plots[0];
    expect(plot?.axes.map((axis) => axis.id)).toEqual(["y1"]);
    expect(plot?.traces.map((trace) => trace.axisId)).toEqual(["y1"]);
  });

  it("reassigns all traces between axes", () => {
    let workspace = createWorkspaceState("time");
    workspace = addAxis(workspace, {});
    workspace = addTrace(workspace, { signal: "v1", axisId: "y2" });
    workspace = addTrace(workspace, { signal: "v2", axisId: "y2" });

    workspace = reassignAxisTraces(workspace, { fromAxisId: "y2", toAxisId: "y1" });

    expect(workspace.plots[0]?.traces.map((trace) => trace.axisId)).toEqual(["y1", "y1"]);
  });
});

describe("workspace reducer", () => {
  it("applies action sequence", () => {
    const actions: WorkspaceAction[] = [
      { type: "plot/add", payload: { xSignal: "vin" } },
      { type: "axis/add" },
      { type: "trace/add", payload: { signal: "vin", axisId: "y2" } }
    ];

    const finalState = actions.reduce(
      (state, action) => reduceWorkspaceState(state, action),
      createWorkspaceState("time")
    );

    const activePlot = finalState.plots.find((plot) => plot.id === finalState.activePlotId);
    expect(activePlot?.xSignal).toBe("vin");
    expect(activePlot?.axes.map((axis) => axis.id)).toEqual(["y1", "y2"]);
    expect(activePlot?.traces).toHaveLength(1);
    expect(activePlot?.traces[0]).toMatchObject({ signal: "vin", axisId: "y2" });
  });
});
