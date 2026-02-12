import { describe, expect, it } from "vitest";

import {
  SIGNAL_TREE_DRAG_MIME,
  extractSignalFromDropData,
  hasSupportedDropSignalType
} from "../../../src/webview/dropSignal";

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
  it("detects eligibility from supported MIME types without reading payload", () => {
    const transfer = {
      types: [SIGNAL_TREE_DRAG_MIME],
      getData: () => {
        throw new Error("should not read drag payload during eligibility checks");
      }
    };
    const eligible = hasSupportedDropSignalType(transfer);
    expect(eligible).toBe(true);
  });

  it("returns false for unsupported drop MIME types", () => {
    const eligible = hasSupportedDropSignalType(
      createDataTransfer({
        "application/json": "{}"
      })
    );
    expect(eligible).toBe(false);
  });

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

  it("extracts signal from readable plain text payload even when types list is incomplete", () => {
    const transfer = {
      types: [],
      getData: (type: string) => (type === "text/plain" ? "vctrl" : "")
    };

    expect(hasSupportedDropSignalType(transfer)).toBe(true);
    expect(extractSignalFromDropData(transfer)).toBe("vctrl");
  });

  it("treats empty drag type lists as potentially supported", () => {
    const transfer = {
      types: [],
      getData: () => ""
    };
    expect(hasSupportedDropSignalType(transfer)).toBe(true);
  });
});
