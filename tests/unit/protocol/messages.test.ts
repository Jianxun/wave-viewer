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

  it("rejects malformed workspaceChanged payloads", () => {
    const parsed = parseWebviewToHostMessage(
      createProtocolEnvelope("webview/workspaceChanged", { workspace: null })
    );
    expect(parsed).toBeUndefined();
  });
});
