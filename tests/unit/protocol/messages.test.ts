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

  it("accepts host workspacePatched with reason and workspace payload", () => {
    const parsed = parseHostToWebviewMessage(
      createProtocolEnvelope("host/workspacePatched", {
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
        reason: "sidePanel:add-to-plot"
      })
    );
    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/workspacePatched",
      payload: {
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
        reason: "sidePanel:add-to-plot"
      }
    });
  });

  it("accepts host viewerBindingUpdated with explicit viewer identity", () => {
    const parsed = parseHostToWebviewMessage(
      createProtocolEnvelope("host/viewerBindingUpdated", {
        viewerId: "viewer-2",
        datasetPath: "/workspace/examples/simulations/ota.spice.csv"
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/viewerBindingUpdated",
      payload: {
        viewerId: "viewer-2",
        datasetPath: "/workspace/examples/simulations/ota.spice.csv"
      }
    });
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

  it("accepts host sidePanelTraceInjected with finite tuple arrays", () => {
    const parsed = parseHostToWebviewMessage(
      createProtocolEnvelope("host/sidePanelTraceInjected", {
        viewerId: "viewer-2",
        trace: {
          traceId: "viewer-2:vin:3",
          sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
          datasetPath: "/workspace/examples/simulations/ota.spice.csv",
          xName: "time",
          yName: "vin",
          x: [0, 1, 2],
          y: [1, 2, 3]
        }
      })
    );

    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/sidePanelTraceInjected",
      payload: {
        viewerId: "viewer-2",
        trace: {
          traceId: "viewer-2:vin:3",
          sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
          datasetPath: "/workspace/examples/simulations/ota.spice.csv",
          xName: "time",
          yName: "vin",
          x: [0, 1, 2],
          y: [1, 2, 3]
        }
      }
    });
  });

  it("rejects host sidePanelTraceInjected when tuple lengths are mismatched", () => {
    const parsed = parseHostToWebviewMessage(
      createProtocolEnvelope("host/sidePanelTraceInjected", {
        viewerId: "viewer-2",
        trace: {
          traceId: "viewer-2:vin:3",
          sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
          datasetPath: "/workspace/examples/simulations/ota.spice.csv",
          xName: "time",
          yName: "vin",
          x: [0, 1],
          y: [1, 2, 3]
        }
      })
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

  it("accepts webview dropSignal payloads for axis targets", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/dropSignal", {
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis", axisId: "y1" },
        source: "axis-row"
      })
    );
    expect(parsed).toEqual({
      version: PROTOCOL_VERSION,
      type: "webview/dropSignal",
      payload: {
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis", axisId: "y1" },
        source: "axis-row"
      }
    });
  });

  it("rejects malformed workspaceChanged payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/workspaceChanged", { workspace: null, reason: "sync" })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects workspaceChanged payloads without reason", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/workspaceChanged", {
        workspace: { activePlotId: "plot-1", plots: [] }
      })
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects malformed webview dropSignal payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/dropSignal", {
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis" },
        source: "axis-row"
      })
    );
    expect(parsed).toBeUndefined();
  });
});
