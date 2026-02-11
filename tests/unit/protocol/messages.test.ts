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
