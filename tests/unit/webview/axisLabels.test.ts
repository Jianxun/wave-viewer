import { describe, expect, it } from "vitest";

import {
  formatAxisLaneLabel,
  formatAxisOptionLabel,
  getLaneNumber
} from "../../../src/webview/components/axisLabels";
import type { AxisState } from "../../../src/webview/state/workspaceState";

const axes: AxisState[] = [{ id: "y1" }, { id: "y2" }, { id: "y3" }];

describe("axisLabels", () => {
  it("returns lane numbers from current axis order", () => {
    expect(getLaneNumber(axes, "y1")).toBe(1);
    expect(getLaneNumber(axes, "y2")).toBe(2);
    expect(getLaneNumber(axes, "y3")).toBe(3);
    expect(getLaneNumber(axes, "y99")).toBeUndefined();
  });

  it("formats axis select labels with explicit lane numbering", () => {
    expect(formatAxisOptionLabel(axes, "y2")).toBe("Y2 (Lane 2)");
    expect(formatAxisOptionLabel(axes, "y99")).toBe("Y99");
  });

  it("formats axis manager labels with lane position", () => {
    expect(formatAxisLaneLabel(axes, axes[0]!)).toBe("Y1 - Lane 1 (Top)");
    expect(formatAxisLaneLabel(axes, axes[1]!)).toBe("Y2 - Lane 2 (Middle)");
    expect(formatAxisLaneLabel(axes, axes[2]!)).toBe("Y3 - Lane 3 (Bottom)");
  });
});
