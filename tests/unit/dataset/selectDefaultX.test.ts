import { describe, expect, it } from "vitest";

import { selectDefaultX } from "../../../src/core/dataset/selectDefaultX";
import type { Dataset } from "../../../src/core/dataset/types";

function createDataset(columnNames: string[]): Dataset {
  return {
    path: "/workspace/examples/demo.csv",
    rowCount: 2,
    columns: columnNames.map((name, index) => ({
      name,
      values: [index, index + 1]
    }))
  };
}

describe("selectDefaultX", () => {
  it("returns time when present", () => {
    const dataset = createDataset(["vin", "time", "vout"]);
    expect(selectDefaultX(dataset)).toBe("time");
  });

  it("returns first numeric signal when time is absent", () => {
    const dataset = createDataset(["vin", "vout"]);
    expect(selectDefaultX(dataset)).toBe("vin");
  });

  it("throws actionable error for empty numeric columns", () => {
    const dataset = createDataset([]);
    expect(() => selectDefaultX(dataset)).toThrow(
      "Cannot select default X signal because dataset has no numeric columns."
    );
  });
});
