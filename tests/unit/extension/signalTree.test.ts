import { describe, expect, it } from "vitest";

import {
  SIGNAL_BROWSER_QUICK_ADD_COMMAND,
  createDoubleClickQuickAddResolver
} from "../../../src/extension/signalTree";

describe("signal tree quick-add", () => {
  it("requires a second click on the same signal within threshold", () => {
    let now = 1_000;
    const resolve = createDoubleClickQuickAddResolver({
      thresholdMs: 500,
      now: () => now
    });

    expect(resolve("vin")).toBe(false);
    now += 300;
    expect(resolve("vin")).toBe(true);
  });

  it("does not trigger when clicks exceed threshold or signal changes", () => {
    let now = 1_000;
    const resolve = createDoubleClickQuickAddResolver({
      thresholdMs: 200,
      now: () => now
    });

    expect(resolve("vin")).toBe(false);
    now += 300;
    expect(resolve("vin")).toBe(false);
    now += 10;
    expect(resolve("vout")).toBe(false);
    now += 10;
    expect(resolve("vin")).toBe(false);
  });

  it("uses stable quick-add command id", () => {
    expect(SIGNAL_BROWSER_QUICK_ADD_COMMAND).toBe("waveViewer.signalBrowser.quickAdd");
  });
});
