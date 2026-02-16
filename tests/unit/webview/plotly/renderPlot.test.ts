import { describe, expect, it, vi } from "vitest";

vi.mock("plotly.js-dist-min", () => ({
  default: {
    react: vi.fn(),
    relayout: vi.fn()
  }
}));

import { createPlotRenderer } from "../../../../src/webview/plotly/renderPlot";
import type { PlotState } from "../../../../src/webview/state/workspaceState";

function createPlot(): PlotState {
  return {
    id: "plot-1",
    name: "Plot 1",
    xSignal: "time",
    axes: [{ id: "y1" }, { id: "y2" }],
    traces: [],
    nextAxisNumber: 3
  };
}

describe("plot renderer keyboard helpers", () => {
  it("binds relayout handler once and supports resetAxes autorange fallback", async () => {
    const on = vi.fn();
    const react = vi.fn().mockResolvedValue(undefined);
    const relayout = vi.fn().mockResolvedValue(undefined);
    const container = { on, _fullLayout: {} } as unknown as HTMLElement;

    const renderer = createPlotRenderer({
      container,
      onRelayout: () => undefined,
      plotly: { react, relayout }
    });

    await renderer.render(createPlot(), new Map());
    await renderer.render(createPlot(), new Map());
    await renderer.resetAxes({ yAxisLayoutKeys: ["yaxis", "yaxis2"] });

    expect(on).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith("plotly_relayout", expect.any(Function));
    expect(relayout).toHaveBeenCalledWith(container, {
      "xaxis.autorange": true,
      "yaxis.autorange": true,
      "yaxis2.autorange": true
    });
  });

  it("resets axes to an explicit data-bounded x viewport", async () => {
    const react = vi.fn().mockResolvedValue(undefined);
    const relayout = vi.fn().mockResolvedValue(undefined);
    const container = { on: vi.fn(), _fullLayout: {} } as unknown as HTMLElement;
    const renderer = createPlotRenderer({
      container,
      onRelayout: () => undefined,
      plotly: { react, relayout }
    });

    await renderer.resetAxes({
      yAxisLayoutKeys: ["yaxis", "yaxis2"],
      xRange: [2, 8]
    });

    expect(relayout).toHaveBeenCalledWith(container, {
      "xaxis.autorange": false,
      "xaxis.range[0]": 2,
      "xaxis.range[1]": 8,
      "xaxis.rangeslider.range[0]": 2,
      "xaxis.rangeslider.range[1]": 8,
      "yaxis.autorange": true,
      "yaxis2.autorange": true
    });
  });

  it("updates active and bound viewport ranges together", async () => {
    const react = vi.fn().mockResolvedValue(undefined);
    const relayout = vi.fn().mockResolvedValue(undefined);
    const container = { on: vi.fn(), _fullLayout: {} } as unknown as HTMLElement;
    const renderer = createPlotRenderer({
      container,
      onRelayout: () => undefined,
      plotly: { react, relayout }
    });

    await renderer.setXViewport({
      activeRange: [4, 6],
      boundRange: [0, 10]
    });

    expect(relayout).toHaveBeenCalledWith(container, {
      "xaxis.autorange": false,
      "xaxis.range[0]": 4,
      "xaxis.range[1]": 6,
      "xaxis.rangeslider.range[0]": 0,
      "xaxis.rangeslider.range[1]": 10
    });
  });

  it("pans x and y ranges by default 10 percent step", async () => {
    const react = vi.fn().mockResolvedValue(undefined);
    const relayout = vi.fn().mockResolvedValue(undefined);
    const container = {
      on: vi.fn(),
      _fullLayout: {
        xaxis: { range: [0, 10] },
        yaxis2: { range: [20, 30] }
      }
    } as unknown as HTMLElement;

    const renderer = createPlotRenderer({
      container,
      onRelayout: () => undefined,
      plotly: { react, relayout }
    });

    const didPanLeft = await renderer.pan({ direction: "left", yAxisLayoutKey: "yaxis2" });
    const didPanUp = await renderer.pan({ direction: "up", yAxisLayoutKey: "yaxis2" });

    expect(didPanLeft).toBe(true);
    expect(didPanUp).toBe(true);
    expect(relayout).toHaveBeenNthCalledWith(1, container, {
      "xaxis.range[0]": -1,
      "xaxis.range[1]": 9
    });
    expect(relayout).toHaveBeenNthCalledWith(2, container, {
      "yaxis2.range[0]": 21,
      "yaxis2.range[1]": 31
    });
  });

  it("does not pan when target axis range is unavailable", async () => {
    const react = vi.fn().mockResolvedValue(undefined);
    const relayout = vi.fn().mockResolvedValue(undefined);
    const container = {
      on: vi.fn(),
      _fullLayout: {
        xaxis: { range: [0, 10] }
      }
    } as unknown as HTMLElement;

    const renderer = createPlotRenderer({
      container,
      onRelayout: () => undefined,
      plotly: { react, relayout }
    });

    const didPan = await renderer.pan({ direction: "up", yAxisLayoutKey: "yaxis2" });

    expect(didPan).toBe(false);
    expect(relayout).not.toHaveBeenCalled();
  });
});
