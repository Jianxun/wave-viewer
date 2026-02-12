import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildSignalPanelModel,
  resolveTraceLaneReassignment
} from "../../../src/webview/components/SignalList";
import {
  addAxis,
  addTrace,
  createWorkspaceState,
  reorderAxis,
  reassignAxisTraces,
  removeTrace
} from "../../../src/webview/state/workspaceState";

describe("signal lane board model", () => {
  it("groups trace chips by lane order and preserves duplicate signal instances by trace id", () => {
    let workspace = createWorkspaceState("time");
    workspace = addAxis(workspace, {});
    workspace = addTrace(workspace, {
      signal: "vin",
      sourceId: "/workspace/examples/a.csv::vin",
      axisId: "y2"
    });
    workspace = addTrace(workspace, {
      signal: "vout",
      sourceId: "/workspace/examples/a.csv::vout",
      axisId: "y1"
    });
    workspace = addTrace(workspace, {
      signal: "vin",
      sourceId: "/workspace/examples/b.csv::vin",
      axisId: "y2"
    });

    const activePlot = workspace.plots[0]!;
    const model = buildSignalPanelModel({
      axes: activePlot.axes,
      traces: activePlot.traces
    });
    const [y1, y2] = model.lanes;

    expect(y1?.axisId).toBe("y1");
    expect(y1?.traceChips).toHaveLength(1);
    expect(y1?.traceChips[0]).toMatchObject({ signal: "vout", axisId: "y1", visible: true });
    expect(y2?.axisId).toBe("y2");
    expect(y2?.traceChips).toHaveLength(2);
    expect(y2?.traceChips[0]?.signal).toBe("vin");
    expect(y2?.traceChips[1]?.signal).toBe("vin");
    expect(y2?.traceChips[0]?.id).not.toBe(y2?.traceChips[1]?.id);
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
    const [lane0, lane1, lane2] = model.lanes;

    expect(lane0).toMatchObject({ axisId: "y2", axisLabel: "Y2 (Lane 1)" });
    expect(lane0?.traceChips.map((trace) => trace.signal)).toEqual(["vout", "vref"]);
    expect(lane1).toMatchObject({ axisId: "y1", axisLabel: "Y1 (Lane 2)" });
    expect(lane1?.traceChips).toEqual([]);
    expect(lane2).toMatchObject({ axisId: "y3", axisLabel: "Y3 (Lane 3)" });
    expect(lane2?.traceChips).toEqual([]);
  });
});

describe("signal lane drag reassignment", () => {
  it("returns trace axis reassignment payload only when dropping onto a new lane", () => {
    let workspace = createWorkspaceState("time");
    workspace = addAxis(workspace, {});
    workspace = addTrace(workspace, { signal: "vin", axisId: "y1" });
    const activePlot = workspace.plots[0]!;
    const traceId = activePlot.traces[0]!.id;

    expect(
      resolveTraceLaneReassignment({
        traces: activePlot.traces,
        traceId,
        targetAxisId: "y2"
      })
    ).toEqual({ traceId, axisId: "y2" });

    expect(
      resolveTraceLaneReassignment({
        traces: activePlot.traces,
        traceId,
        targetAxisId: "y1"
      })
    ).toBeUndefined();

    expect(
      resolveTraceLaneReassignment({
        traces: activePlot.traces,
        traceId: "trace-missing",
        targetAxisId: "y2"
      })
    ).toBeUndefined();
  });

  it("wires draggable trace chips and lane drop targets in signal list rendering", () => {
    const source = fs.readFileSync(path.resolve("src/webview/components/SignalList.ts"), "utf8");

    expect(source).toContain("chip.draggable = true;");
    expect(source).toContain("laneSection.body.dataset.axisId = lane.axisId;");
    expect(source).toContain("props.onSetAxis(reassignment.traceId, reassignment.axisId);");
    expect(source).toContain('event.dataTransfer?.setData("text/wave-viewer-trace-id", trace.id);');
    expect(source).toContain('moveUpButton.textContent = "Up";');
    expect(source).toContain('moveDownButton.textContent = "Down";');
    expect(source).toContain('closeButton.textContent = "Close";');
    expect(source).toContain("props.onReorderLane({");
    expect(source).toContain("props.onRemoveLane({");
    expect(source).toContain("traceIds: lane.traceChips.map((trace) => trace.id)");
    expect(source).toContain('body.textContent = "Click here to create a new lane";');
    expect(source).toContain("options.onCreateLane(options.afterAxisId);");
    expect(source).toContain('target: { kind: "new-axis", afterAxisId: lastLaneAxisId }');
  });
});

describe("signal panel model", () => {
  it("adds an active-axis row marker in axis manager rendering", () => {
    const source = fs.readFileSync(path.resolve("src/webview/components/AxisManager.ts"), "utf8");
    const css = fs.readFileSync(path.resolve("src/webview/styles.css"), "utf8");
    const main = fs.readFileSync(path.resolve("src/webview/main.ts"), "utf8");

    expect(source).toContain("activeAxisId?: AxisId");
    expect(source).toContain('row.classList.toggle("axis-row-active", axis.id === props.activeAxisId);');
    expect(css).toContain(".axis-row-active");
    expect(main).toContain("activeAxisId: preferredDropAxisId");
  });
});
