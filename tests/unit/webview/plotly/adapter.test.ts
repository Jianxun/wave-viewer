import { describe, expect, it } from "vitest";

import {
  buildRenderAxisMappings,
  buildPlotlyFigure,
  getAxisLaneDomains,
  mapLaneIndexToPlotly,
  parseRelayoutRanges,
  resolveAxisIdFromNormalizedY
} from "../../../../src/webview/plotly/adapter";
import type { AxisState, PlotState } from "../../../../src/webview/state/workspaceState";
import type { SidePanelTraceTuplePayload } from "../../../../src/core/dataset/types";

const traceTuplesBySourceId = new Map<string, SidePanelTraceTuplePayload>([
  [
    "/workspace/examples/a.csv::vin",
    {
      traceId: "trace-1",
      sourceId: "/workspace/examples/a.csv::vin",
      datasetPath: "/workspace/examples/a.csv",
      xName: "time",
      yName: "vin",
      x: [0, 1, 2],
      y: [1, 2, 3]
    }
  ],
  [
    "/workspace/examples/a.csv::vout",
    {
      traceId: "trace-2",
      sourceId: "/workspace/examples/a.csv::vout",
      datasetPath: "/workspace/examples/a.csv",
      xName: "time",
      yName: "vout",
      x: [0, 1, 2],
      y: [3, 2, 1]
    }
  ]
]);

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
      {
        id: "trace-1",
        signal: "vin",
        sourceId: "/workspace/examples/a.csv::vin",
        axisId: "y1",
        visible: true
      },
      {
        id: "trace-2",
        signal: "vout",
        sourceId: "/workspace/examples/a.csv::vout",
        axisId: "y2",
        visible: false
      }
    ],
    nextAxisNumber: 3,
    ...overrides
  };
}

describe("plotly adapter", () => {
  it("maps render lane indexes to plotly axis ids", () => {
    expect(mapLaneIndexToPlotly(0)).toEqual({ traceRef: "y", layoutKey: "yaxis" });
    expect(mapLaneIndexToPlotly(1)).toEqual({ traceRef: "y2", layoutKey: "yaxis2" });
    expect(mapLaneIndexToPlotly(4)).toEqual({ traceRef: "y5", layoutKey: "yaxis5" });
  });

  it("builds render axis mappings from axis order", () => {
    const mappings = buildRenderAxisMappings([{ id: "y3" }, { id: "y1" }, { id: "y2" }]);
    expect(mappings.map((entry) => `${entry.axisId}:${entry.layoutKey}`)).toEqual([
      "y3:yaxis",
      "y1:yaxis2",
      "y2:yaxis3"
    ]);
  });

  it("maps plot state to traces/layout with visibility and axis mapping", () => {
    const figure = buildPlotlyFigure({
      plot: createPlot(),
      traceTuplesBySourceId
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
      rangeslider: { visible: false, autorange: true, range: [0, 2] },
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
      traceTuplesBySourceId
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
      traceTuplesBySourceId
    });

    expect((figure.layout.yaxis as { domain?: [number, number] }).domain?.[0]).toBeCloseTo(
      0.6933333333333334
    );
    expect((figure.layout.yaxis as { domain?: [number, number] }).domain?.[1]).toBeCloseTo(1);
    expect((figure.layout.yaxis2 as { domain?: [number, number] }).domain?.[0]).toBeCloseTo(
      0.3466666666666667
    );
    expect((figure.layout.yaxis2 as { domain?: [number, number] }).domain?.[1]).toBeCloseTo(
      0.6533333333333333
    );
    expect((figure.layout.yaxis3 as { domain?: [number, number] }).domain?.[0]).toBeCloseTo(0);
    expect((figure.layout.yaxis3 as { domain?: [number, number] }).domain?.[1]).toBeCloseTo(
      0.30666666666666664
    );
    expect(figure.data.map((trace) => `${trace.name}@${trace.yaxis}`)).toEqual(["vin@y2", "vout@y3"]);
  });

  it("keeps shared x-axis tick anchoring stable when lane order changes", () => {
    const basePlot = createPlot({
      axes: [{ id: "y1" }, { id: "y2" }, { id: "y3" }],
      traces: [
        {
          id: "trace-1",
          signal: "vin",
          sourceId: "/workspace/examples/a.csv::vin",
          axisId: "y1",
          visible: true
        },
        {
          id: "trace-2",
          signal: "vout",
          sourceId: "/workspace/examples/a.csv::vout",
          axisId: "y3",
          visible: true
        }
      ]
    });
    const reorderedPlot = createPlot({
      axes: [{ id: "y3" }, { id: "y1" }, { id: "y2" }],
      traces: [
        {
          id: "trace-1",
          signal: "vin",
          sourceId: "/workspace/examples/a.csv::vin",
          axisId: "y1",
          visible: true
        },
        {
          id: "trace-2",
          signal: "vout",
          sourceId: "/workspace/examples/a.csv::vout",
          axisId: "y3",
          visible: true
        }
      ]
    });

    const baseline = buildPlotlyFigure({ plot: basePlot, traceTuplesBySourceId });
    const reordered = buildPlotlyFigure({ plot: reorderedPlot, traceTuplesBySourceId });

    expect(baseline.layout.xaxis).toMatchObject({ fixedrange: false });
    expect(reordered.layout.xaxis).toMatchObject({ fixedrange: false });
    expect(reordered.data.map((trace) => `${trace.name}@${trace.yaxis}`)).toEqual(["vin@y2", "vout@y"]);
  });

  it("uses full domain when a plot has one lane", () => {
    const figure = buildPlotlyFigure({
      plot: createPlot({
        axes: [{ id: "y1" }]
      }),
      traceTuplesBySourceId
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

  it("parses relayout updates using render axis mapping for reordered lanes", () => {
    const axes: AxisState[] = [{ id: "y3" }, { id: "y1" }, { id: "y2" }];

    const update = parseRelayoutRanges(
      {
        "yaxis2.range[0]": -1,
        "yaxis2.range[1]": 1,
        "yaxis3.autorange": true
      },
      axes
    );

    expect(update).toEqual({
      hasChanges: true,
      xRange: undefined,
      axisRanges: [
        { axisId: "y1", range: [-1, 1] },
        { axisId: "y2", range: undefined }
      ]
    });
  });

  it("renders mixed-grid traces from different sources in one figure", () => {
    const mixedSourcePlot = createPlot({
      traces: [
        {
          id: "trace-1",
          signal: "vin",
          sourceId: "/workspace/examples/a.csv::vin",
          axisId: "y1",
          visible: true
        },
        {
          id: "trace-2",
          signal: "vin",
          sourceId: "/workspace/examples/b.csv::vin",
          axisId: "y2",
          visible: true
        }
      ]
    });
    const mixedSourceTuples = new Map(traceTuplesBySourceId);
    mixedSourceTuples.set("/workspace/examples/b.csv::vin", {
      traceId: "trace-2",
      sourceId: "/workspace/examples/b.csv::vin",
      datasetPath: "/workspace/examples/b.csv",
      xName: "frequency",
      yName: "vin",
      x: [10, 100, 1000],
      y: [0.1, 0.2, 0.3]
    });

    const figure = buildPlotlyFigure({
      plot: mixedSourcePlot,
      traceTuplesBySourceId: mixedSourceTuples
    });

    expect(figure.data).toHaveLength(2);
    expect(figure.data[0]).toMatchObject({ x: [0, 1, 2], y: [1, 2, 3], yaxis: "y" });
    expect(figure.data[1]).toMatchObject({
      x: [10, 100, 1000],
      y: [0.1, 0.2, 0.3],
      yaxis: "y2"
    });
  });
});
