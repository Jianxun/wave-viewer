import { describe, expect, it } from "vitest";

import { parseCsv } from "../../../src/core/csv/parseCsv";

describe("parseCsv", () => {
  it("parses numeric columns into dataset and preserves row order", () => {
    const csvText = ["time,vin,label", "0,1.25,start", "1,2.5,mid", "2,3.75,end"].join("\n");

    const dataset = parseCsv({
      path: "/workspace/examples/demo.csv",
      csvText
    });

    expect(dataset).toEqual({
      path: "/workspace/examples/demo.csv",
      rowCount: 3,
      columns: [
        { name: "time", values: [0, 1, 2] },
        { name: "vin", values: [1.25, 2.5, 3.75] }
      ]
    });
  });

  it("throws actionable error for malformed row width", () => {
    const csvText = ["time,vin", "0,1", "1"].join("\n");

    expect(() =>
      parseCsv({
        path: "/workspace/examples/bad.csv",
        csvText
      })
    ).toThrow("Malformed CSV row 3 in /workspace/examples/bad.csv: expected 2 columns, got 1.");
  });

  it("throws actionable error when no numeric columns exist", () => {
    const csvText = ["label,status", "startup,ok", "settled,good"].join("\n");

    expect(() =>
      parseCsv({
        path: "/workspace/examples/non_numeric.csv",
        csvText
      })
    ).toThrow(
      "CSV file /workspace/examples/non_numeric.csv has no numeric columns to plot."
    );
  });
});
