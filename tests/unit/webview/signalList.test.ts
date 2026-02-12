import { describe, expect, it } from "vitest";

import { buildSignalPanelModel } from "../../../src/webview/components/SignalList";
import {
  addAxis,
  addTrace,
  createWorkspaceState,
  reorderAxis,
  reassignAxisTraces,
  removeTrace
} from "../../../src/webview/state/workspaceState";

describe("signal panel model", () => {
  it("groups assigned signals by lane order", () => {
    let workspace = createWorkspaceState("time");
    workspace = addAxis(workspace, {});
    workspace = addTrace(workspace, { signal: "vin", axisId: "y2" });
    workspace = addTrace(workspace, { signal: "vout", axisId: "y1" });
    workspace = addTrace(workspace, { signal: "vin", axisId: "y2" });

    const activePlot = workspace.plots[0]!;
    const model = buildSignalPanelModel({
      axes: activePlot.axes,
      traces: activePlot.traces
    });

    expect(model.lanes).toEqual([
      { axisId: "y1", axisLabel: "Y1 (Lane 1)", assignedSignals: ["vout"] },
      { axisId: "y2", axisLabel: "Y2 (Lane 2)", assignedSignals: ["vin", "vin"] }
    ]);
  });

  it("remains deterministic across reassign, reorder, and remove operations", () => {
    let workspace = createWorkspaceState("time");
    workspace = addAxis(workspace, {});
    workspace = addAxis(workspace, {});
    workspace = addTrace(workspace, { signal: "vin", axisId: "y1" });
    workspace = addTrace(workspace, { signal: "vout", axisId: "y2" });
    workspace = addTrace(workspace, { signal: "vref", axisId: "y3" });

    workspace = reassignAxisTraces(workspace, { fromAxisId: "y3", toAxisId: "y2" });
    workspace = reorderAxis(workspace, { axisId: "y2", toIndex: 0 });

    const traceIdToRemove = workspace.plots[0]!.traces.find((trace) => trace.signal === "vin")!.id;
    workspace = removeTrace(workspace, { traceId: traceIdToRemove });

    const activePlot = workspace.plots[0]!;
    const model = buildSignalPanelModel({
      axes: activePlot.axes,
      traces: activePlot.traces
    });

    expect(model.lanes).toEqual([
      { axisId: "y2", axisLabel: "Y2 (Lane 1)", assignedSignals: ["vout", "vref"] },
      { axisId: "y1", axisLabel: "Y1 (Lane 2)", assignedSignals: [] },
      { axisId: "y3", axisLabel: "Y3 (Lane 3)", assignedSignals: [] }
    ]);
  });
});
