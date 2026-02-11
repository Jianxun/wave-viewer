import { describe, expect, it } from "vitest";

import {
  buildPlotlyFigure,
  getAxisLaneDomains,
  mapAxisIdToPlotly,
  parseRelayoutRanges,
  resolveAxisIdFromNormalizedY,
  type DatasetColumnData
} from "../../../../src/webview/plotly/adapter";
import type { AxisState, PlotState } from "../../../../src/webview/state/workspaceState";

const columns: DatasetColumnData[] = [
  { name: "time", values: [0, 1, 2] },
  { name: "vin", values: [1, 2, 3] },
  { name: "vout", values: [3, 2, 1] }
];

function createPlot(overrides?: Partial<PlotState>): PlotState {
  const axes: AxisState[] = [
    { id: "y1", title: "Input" },
    { id: "y2", title: "Output" }
  ];

  return {
    id: "plot-1",
    name: "Plot 1",
    xSignal: "time",
    axes,
    traces: [
      { id: "trace-1", signal: "vin", axisId: "y1", visible: true },
      { id: "trace-2", signal: "vout", axisId: "y2", visible: false }
    ],
    nextAxisNumber: 3,
    ...overrides
  };
}

describe("plotly adapter", () => {
  it("maps y1..yN to plotly axis ids", () => {
    expect(mapAxisIdToPlotly("y1")).toEqual({ traceRef: "y", layoutKey: "yaxis" });
    expect(mapAxisIdToPlotly("y2")).toEqual({ traceRef: "y2", layoutKey: "yaxis2" });
    expect(mapAxisIdToPlotly("y5")).toEqual({ traceRef: "y5", layoutKey: "yaxis5" });
  });

  it("maps plot state to traces/layout with visibility and axis mapping", () => {
    const figure = buildPlotlyFigure({
      plot: createPlot(),
      columns
    });

    expect(figure.data).toHaveLength(2);
    expect(figure.data[0]).toMatchObject({
      name: "vin",
      x: [0, 1, 2],
      y: [1, 2, 3],
      yaxis: "y",
      visible: true
    });
    expect(figure.data[1]).toMatchObject({
      name: "vout",
      x: [0, 1, 2],
      y: [3, 2, 1],
      yaxis: "y2",
      visible: false
    });

    expect(figure.layout.xaxis).toMatchObject({
      title: { text: "time" },
      rangeslider: { visible: true, autorange: true, range: [0, 2] },
      autorange: true,
      fixedrange: false
    });
    expect(figure.layout).toMatchObject({
      template: "plotly_dark",
      paper_bgcolor: "#101723",
      plot_bgcolor: "#101723",
      dragmode: "zoom"
    });
    expect(figure.layout.yaxis).toMatchObject({ domain: [0.52, 1], anchor: "x" });
    expect(figure.layout.yaxis2).toMatchObject({ domain: [0, 0.48], anchor: "x" });
    expect(figure.layout.yaxis).toMatchObject({ fixedrange: false });
    expect(figure.layout.yaxis2).toMatchObject({ fixedrange: false });
    expect(figure.layout.shapes).toHaveLength(2);
    expect(figure.layout.shapes?.[0]).toMatchObject({
      type: "rect",
      xref: "paper",
      yref: "paper",
      x0: 0,
      x1: 1,
      y0: 0.52,
      y1: 1
    });
    expect(figure.layout.shapes?.[1]).toMatchObject({
      type: "rect",
      xref: "paper",
      yref: "paper",
      x0: 0,
      x1: 1,
      y0: 0,
      y1: 0.48
    });
  });

  it("restores persisted x/y ranges into plotly layout", () => {
    const figure = buildPlotlyFigure({
      plot: createPlot({
        xRange: [0.2, 1.8],
        axes: [
          { id: "y1", range: [1, 4] },
          { id: "y2", range: [0, 5] }
        ]
      }),
      columns
    });

    expect(figure.layout.xaxis).toMatchObject({ autorange: false, range: [0.2, 1.8] });
    expect(figure.layout.yaxis).toMatchObject({ range: [1, 4] });
    expect(figure.layout.yaxis2).toMatchObject({ range: [0, 5] });
  });

  it("uses axis order as top-to-bottom lane order for domains", () => {
    const figure = buildPlotlyFigure({
      plot: createPlot({
        axes: [{ id: "y3" }, { id: "y1" }, { id: "y2" }]
      }),
      columns
    });

    expect((figure.layout.yaxis3 as { domain?: [number, number] }).domain?.[0]).toBeCloseTo(
      0.6933333333333334
    );
    expect((figure.layout.yaxis3 as { domain?: [number, number] }).domain?.[1]).toBeCloseTo(1);
    expect((figure.layout.yaxis as { domain?: [number, number] }).domain?.[0]).toBeCloseTo(
      0.3466666666666667
    );
    expect((figure.layout.yaxis as { domain?: [number, number] }).domain?.[1]).toBeCloseTo(
      0.6533333333333333
    );
    expect((figure.layout.yaxis2 as { domain?: [number, number] }).domain?.[0]).toBeCloseTo(0);
    expect((figure.layout.yaxis2 as { domain?: [number, number] }).domain?.[1]).toBeCloseTo(
      0.30666666666666664
    );
  });

  it("uses full domain when a plot has one lane", () => {
    const figure = buildPlotlyFigure({
      plot: createPlot({
        axes: [{ id: "y1" }]
      }),
      columns
    });

    expect(figure.layout.yaxis).toMatchObject({ domain: [0, 1] });
  });

  it("returns axis lane domains using axis order and shared domain math", () => {
    const domains = getAxisLaneDomains([{ id: "y3" }, { id: "y1" }, { id: "y2" }]);
    expect(domains.map((entry) => entry.axisId)).toEqual(["y3", "y1", "y2"]);
    expect(domains[0]?.domain[0]).toBeCloseTo(0.6933333333333334);
    expect(domains[0]?.domain[1]).toBeCloseTo(1);
    expect(domains[1]?.domain[0]).toBeCloseTo(0.3466666666666667);
    expect(domains[1]?.domain[1]).toBeCloseTo(0.6533333333333333);
    expect(domains[2]?.domain[0]).toBeCloseTo(0);
    expect(domains[2]?.domain[1]).toBeCloseTo(0.30666666666666664);
  });

  it("resolves normalized Y to axis ids and snaps gap positions to nearest lane", () => {
    const axes: AxisState[] = [{ id: "y1" }, { id: "y2" }];
    expect(resolveAxisIdFromNormalizedY(axes, 0.75)).toBe("y1");
    expect(resolveAxisIdFromNormalizedY(axes, 0.2)).toBe("y2");
    expect(resolveAxisIdFromNormalizedY(axes, 0.5)).toBe("y2");
    expect(resolveAxisIdFromNormalizedY(axes, 0.505)).toBe("y1");
  });

  it("parses relayout updates for range capture and reset", () => {
    const axisIds: AxisState[] = [
      { id: "y1" },
      { id: "y2" }
    ];

    const zoomUpdate = parseRelayoutRanges(
      {
        "xaxis.range[0]": 0,
        "xaxis.range[1]": 10,
        "yaxis2.range[0]": -2,
        "yaxis2.range[1]": 2
      },
      axisIds
    );

    expect(zoomUpdate).toEqual({
      hasChanges: true,
      xRange: [0, 10],
      axisRanges: [{ axisId: "y2", range: [-2, 2] }]
    });

    const resetUpdate = parseRelayoutRanges(
      {
        "xaxis.autorange": true,
        "yaxis.autorange": true
      },
      axisIds
    );

    expect(resetUpdate).toEqual({
      hasChanges: true,
      xRange: undefined,
      axisRanges: [{ axisId: "y1", range: undefined }]
    });
  });
});
