import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  createProtocolEnvelope,
  parseHostToWebviewMessage,
  parseWebviewToHostMessage
} from "../../../src/core/dataset/types";

describe("protocol envelope validators", () => {
  it("accepts known host messages wrapped in versioned envelopes", () => {
    const parsed = parseHostToWebviewMessage(
      createProtocolEnvelope("host/init", { title: "Wave Viewer" })
    );
    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/init",
      payload: { title: "Wave Viewer" }
    });
  });

  it("accepts host statePatch with revision, viewer state, reason, and workspace payload", () => {
    const parsed = parseHostToWebviewMessage(
      createProtocolEnvelope("host/statePatch", {
        revision: 3,
        workspace: {
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
        },
        viewerState: {
          activePlotId: "plot-1",
          activeAxisByPlotId: { "plot-1": "y1" }
        },
        reason: "sidePanel:add-to-plot"
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/statePatch",
      payload: {
        revision: 3,
        workspace: {
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
        },
        viewerState: {
          activePlotId: "plot-1",
          activeAxisByPlotId: { "plot-1": "y1" }
        },
        reason: "sidePanel:add-to-plot"
      }
    });
  });

  it("rejects host statePatch without non-negative integer revision", () => {
    const parsed = parseHostToWebviewMessage(
      createProtocolEnvelope("host/statePatch", {
        revision: -1,
        workspace: { activePlotId: "plot-1", plots: [] },
        viewerState: { activePlotId: "plot-1", activeAxisByPlotId: {} },
        reason: "sync"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("accepts host tupleUpsert with finite tuple arrays", () => {
    const parsed = parseHostToWebviewMessage(
      createProtocolEnvelope("host/tupleUpsert", {
        tuples: [
          {
            traceId: "viewer-2:vin:3",
            sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
            datasetPath: "/workspace/examples/simulations/ota.spice.csv",
            xName: "time",
            yName: "vin",
            x: [0, 1, 2],
            y: [1, 2, 3]
          }
        ]
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/tupleUpsert",
      payload: {
        tuples: [
          {
            traceId: "viewer-2:vin:3",
            sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
            datasetPath: "/workspace/examples/simulations/ota.spice.csv",
            xName: "time",
            yName: "vin",
            x: [0, 1, 2],
            y: [1, 2, 3]
          }
        ]
      }
    });
  });

  it("accepts host sidePanelQuickAdd with explicit plot and axis target", () => {
    const parsed = parseHostToWebviewMessage(
      createProtocolEnvelope("host/sidePanelQuickAdd", {
        signal: "vin",
        plotId: "plot-2",
        axisId: "y2"
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/sidePanelQuickAdd",
      payload: {
        signal: "vin",
        plotId: "plot-2",
        axisId: "y2"
      }
    });
  });

  it("rejects host sidePanelQuickAdd when plot and axis target are partially specified", () => {
    const parsed = parseHostToWebviewMessage(
      createProtocolEnvelope("host/sidePanelQuickAdd", {
        signal: "vin",
        plotId: "plot-2"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects host tupleUpsert when tuple lengths are mismatched", () => {
    const parsed = parseHostToWebviewMessage(
      createProtocolEnvelope("host/tupleUpsert", {
        tuples: [
          {
            traceId: "viewer-2:vin:3",
            sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
            datasetPath: "/workspace/examples/simulations/ota.spice.csv",
            xName: "time",
            yName: "vin",
            x: [0, 1],
            y: [1, 2, 3]
          }
        ]
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects host messages with invalid envelope version", () => {
    const parsed = parseHostToWebviewMessage({
      version: 99,
      type: "host/init",
      payload: { title: "Wave Viewer" }
    });
    expect(parsed).toBeUndefined();
  });

  it("rejects host messages with unknown type", () => {
    const parsed = parseHostToWebviewMessage(
      createProtocolEnvelope("host/unknown", { foo: "bar" })
    );
    expect(parsed).toBeUndefined();
  });

  it("accepts known webview messages wrapped in versioned envelopes", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/ready", { ready: true })
    );
    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "webview/ready",
      payload: { ready: true }
    });
  });

  it("accepts webview intent dropSignal payloads for axis targets", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/dropSignal", {
        viewerId: "viewer-1",
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis", axisId: "y1" },
        source: "axis-row",
        requestId: "req-1"
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "webview/intent/dropSignal",
      payload: {
        viewerId: "viewer-1",
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis", axisId: "y1" },
        source: "axis-row",
        requestId: "req-1"
      }
    });
  });

  it("accepts webview intent dropSignal payloads for new-axis targets with insertion anchors", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/dropSignal", {
        viewerId: "viewer-1",
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "new-axis", afterAxisId: "y2" },
        source: "axis-row",
        requestId: "req-1"
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "webview/intent/dropSignal",
      payload: {
        viewerId: "viewer-1",
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "new-axis", afterAxisId: "y2" },
        source: "axis-row",
        requestId: "req-1"
      }
    });
  });

  it("accepts webview intent setActiveAxis payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/setActiveAxis", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        axisId: "y2",
        requestId: "req-2"
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "webview/intent/setActiveAxis",
      payload: {
        viewerId: "viewer-1",
        plotId: "plot-1",
        axisId: "y2",
        requestId: "req-2"
      }
    });
  });

  it("accepts webview intent renamePlot payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/renamePlot", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        name: "Scope A",
        requestId: "req-rename-1"
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "webview/intent/renamePlot",
      payload: {
        viewerId: "viewer-1",
        plotId: "plot-1",
        name: "Scope A",
        requestId: "req-rename-1"
      }
    });
  });

  it("accepts webview intent setTraceAxis payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/setTraceAxis", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        traceId: "trace-1",
        axisId: "y2",
        requestId: "req-3"
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "webview/intent/setTraceAxis",
      payload: {
        viewerId: "viewer-1",
        plotId: "plot-1",
        traceId: "trace-1",
        axisId: "y2",
        requestId: "req-3"
      }
    });
  });

  it("accepts webview intent addAxis payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/addAxis", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        afterAxisId: "y2",
        requestId: "req-4"
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "webview/intent/addAxis",
      payload: {
        viewerId: "viewer-1",
        plotId: "plot-1",
        afterAxisId: "y2",
        requestId: "req-4"
      }
    });
  });

  it("accepts webview intent reorderAxis payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/reorderAxis", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        axisId: "y2",
        toIndex: 0,
        requestId: "req-5"
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "webview/intent/reorderAxis",
      payload: {
        viewerId: "viewer-1",
        plotId: "plot-1",
        axisId: "y2",
        toIndex: 0,
        requestId: "req-5"
      }
    });
  });

  it("accepts webview intent removeAxisAndTraces payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/removeAxisAndTraces", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        axisId: "y2",
        traceIds: ["trace-1", "trace-2"],
        requestId: "req-6"
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "webview/intent/removeAxisAndTraces",
      payload: {
        viewerId: "viewer-1",
        plotId: "plot-1",
        axisId: "y2",
        traceIds: ["trace-1", "trace-2"],
        requestId: "req-6"
      }
    });
  });

  it("accepts webview intent setTraceVisible payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/setTraceVisible", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        traceId: "trace-1",
        visible: false,
        requestId: "req-7"
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "webview/intent/setTraceVisible",
      payload: {
        viewerId: "viewer-1",
        plotId: "plot-1",
        traceId: "trace-1",
        visible: false,
        requestId: "req-7"
      }
    });
  });

  it("accepts webview intent removeTrace payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/removeTrace", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        traceId: "trace-1",
        requestId: "req-8"
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "webview/intent/removeTrace",
      payload: {
        viewerId: "viewer-1",
        plotId: "plot-1",
        traceId: "trace-1",
        requestId: "req-8"
      }
    });
  });

  it("rejects malformed webview intent setActiveAxis payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/setActiveAxis", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        requestId: "req-2"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects malformed webview intent renamePlot payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/renamePlot", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        name: "   ",
        requestId: "req-rename-1"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects malformed webview intent setTraceAxis payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/setTraceAxis", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        traceId: "trace-1",
        axisId: "axis-two",
        requestId: "req-3"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects malformed webview intent addAxis payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/addAxis", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        afterAxisId: "axis-two",
        requestId: "req-4"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects malformed webview intent reorderAxis payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/reorderAxis", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        axisId: "axis-two",
        toIndex: -1,
        requestId: "req-5"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects malformed webview intent removeAxisAndTraces payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/removeAxisAndTraces", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        axisId: "axis-two",
        traceIds: ["trace-1", ""],
        requestId: "req-6"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects malformed webview intent setTraceVisible payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/setTraceVisible", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        traceId: "trace-1",
        visible: "nope",
        requestId: "req-7"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects malformed webview intent removeTrace payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/removeTrace", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        requestId: "req-8"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects malformed webview intent dropSignal payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/dropSignal", {
        viewerId: "viewer-1",
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis" },
        source: "axis-row",
        requestId: "req-1"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects dropSignal new-axis payloads with invalid insertion anchors", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/dropSignal", {
        viewerId: "viewer-1",
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "new-axis", afterAxisId: "axis-two" },
        source: "axis-row",
        requestId: "req-1"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects webview intent addSignalToActiveAxis without requestId", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/intent/addSignalToActiveAxis", {
        viewerId: "viewer-1",
        signal: "vin"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects legacy webview/dropSignal payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/dropSignal", {
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis", axisId: "y1" },
        source: "axis-row"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects legacy webview/command payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/command", {
        command: "zoomToFit"
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects removed webview/workspaceChanged payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/workspaceChanged", {
        workspace: { activePlotId: "plot-1", plots: [] },
        reason: "webview-sync"
      })
    );
    expect(parsed).toBeUndefined();
  });
});
