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
