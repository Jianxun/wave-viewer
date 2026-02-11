import { describe, expect, it } from "vitest";

import { SIGNAL_TREE_DRAG_MIME, extractSignalFromDropData } from "../../../src/webview/dropSignal";

type DataTransferLike = {
  types: readonly string[];
  getData(type: string): string;
};

function createDataTransfer(values: Record<string, string>): DataTransferLike {
  const types = Object.keys(values);
  return {
    types,
    getData: (type) => values[type] ?? ""
  };
}

describe("drop signal parsing", () => {
  it("reads signal from plain text drag payload", () => {
    const signal = extractSignalFromDropData(
      createDataTransfer({
        "text/plain": "vin"
      })
    );
    expect(signal).toBe("vin");
  });

  it("reads signal from tree drag payload object", () => {
    const signal = extractSignalFromDropData(
      createDataTransfer({
        [SIGNAL_TREE_DRAG_MIME]: JSON.stringify({ signal: "vout" })
      })
    );
    expect(signal).toBe("vout");
  });

  it("reads signal from tree drag payload array", () => {
    const signal = extractSignalFromDropData(
      createDataTransfer({
        [SIGNAL_TREE_DRAG_MIME]: JSON.stringify([{ signal: "vref" }])
      })
    );
    expect(signal).toBe("vref");
  });

  it("returns undefined for malformed payloads", () => {
    const signal = extractSignalFromDropData(
      createDataTransfer({
        [SIGNAL_TREE_DRAG_MIME]: JSON.stringify({ signal: "" }),
        "text/plain": "   "
      })
    );
    expect(signal).toBeUndefined();
  });
});
