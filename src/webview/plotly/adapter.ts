import type { AxisId, AxisState, PlotState } from "../state/workspaceState";

export type DatasetColumnData = {
  name: string;
  values: number[];
};

export type PlotlyTrace = {
  type: "scatter";
  mode: "lines";
  name: string;
  x: number[];
  y: number[];
  yaxis: string;
  visible: boolean;
  line?: {
    color?: string;
    width?: number;
  };
};

export type PlotlyAxisLayout = {
  title?: { text: string };
  side?: "left" | "right";
  type?: "linear" | "log";
  range?: [number, number];
  overlaying?: "y";
  anchor?: "x";
  automargin?: boolean;
};

export type PlotlyLayout = {
  margin: { l: number; r: number; t: number; b: number };
  showlegend: boolean;
  hovermode: "x unified";
  legend: { orientation: "h"; y: number; x: number };
  xaxis: {
    title?: { text: string };
    range?: [number, number];
    automargin: boolean;
  };
  [key: string]: unknown;
};

export type PlotlyFigure = {
  data: PlotlyTrace[];
  layout: PlotlyLayout;
};

export function mapAxisIdToPlotly(axisId: AxisId): { traceRef: string; layoutKey: string } {
  if (axisId === "y1") {
    return { traceRef: "y", layoutKey: "yaxis" };
  }

  const suffix = axisId.slice(1);
  return {
    traceRef: `y${suffix}`,
    layoutKey: `yaxis${suffix}`
  };
}

export function buildPlotlyFigure(payload: {
  plot: PlotState;
  columns: DatasetColumnData[];
}): PlotlyFigure {
  const columnsByName = new Map(payload.columns.map((column) => [column.name, column.values] as const));
  const xValues = columnsByName.get(payload.plot.xSignal) ?? [];

  const data: PlotlyTrace[] = payload.plot.traces.map((trace) => {
    const yValues = columnsByName.get(trace.signal) ?? [];
    const axisMap = mapAxisIdToPlotly(trace.axisId);

    return {
      type: "scatter",
      mode: "lines",
      name: trace.signal,
      x: xValues,
      y: yValues,
      yaxis: axisMap.traceRef,
      visible: trace.visible,
      line: {
        color: trace.color,
        width: trace.lineWidth
      }
    };
  });

  const layout: PlotlyLayout = {
    margin: { l: 48, r: 48, t: 20, b: 44 },
    showlegend: true,
    hovermode: "x unified",
    legend: { orientation: "h", y: 1.08, x: 0 },
    xaxis: {
      title: { text: payload.plot.xSignal },
      range: payload.plot.xRange,
      automargin: true
    }
  };

  for (const axis of payload.plot.axes) {
    const mapping = mapAxisIdToPlotly(axis.id);
    layout[mapping.layoutKey] = toAxisLayout(axis);
  }

  return { data, layout };
}

function toAxisLayout(axis: AxisState): PlotlyAxisLayout {
  const axisLayout: PlotlyAxisLayout = {
    title: axis.title ? { text: axis.title } : undefined,
    side: axis.side,
    type: axis.scale === "log" ? "log" : "linear",
    range: axis.range,
    automargin: true
  };

  if (axis.id !== "y1") {
    axisLayout.overlaying = "y";
    axisLayout.anchor = "x";
  }

  return axisLayout;
}

export type PlotRangeUpdates = {
  hasChanges: boolean;
  xRange?: [number, number];
  axisRanges: Array<{ axisId: AxisId; range?: [number, number] }>;
};

export function parseRelayoutRanges(
  relayoutData: Record<string, unknown>,
  axes: AxisState[]
): PlotRangeUpdates {
  const axisRanges: Array<{ axisId: AxisId; range?: [number, number] }> = [];
  const xRangeRead = readRangeUpdate(relayoutData, "xaxis");

  for (const axis of axes) {
    const plotlyAxis = mapAxisIdToPlotly(axis.id).layoutKey;
    const axisRead = readRangeUpdate(relayoutData, plotlyAxis);
    if (axisRead.present) {
      axisRanges.push({ axisId: axis.id, range: axisRead.range });
    }
  }

  const hasChanges = xRangeRead.present || axisRanges.length > 0;

  return {
    hasChanges,
    xRange: xRangeRead.present ? xRangeRead.range : undefined,
    axisRanges
  };
}

function readRangeUpdate(
  relayoutData: Record<string, unknown>,
  axisPrefix: string
): { present: boolean; range?: [number, number] } {
  const autorangeKey = `${axisPrefix}.autorange`;
  if (autorangeKey in relayoutData && relayoutData[autorangeKey] === true) {
    return { present: true, range: undefined };
  }

  const rangeArrayKey = `${axisPrefix}.range`;
  const rangeValue = relayoutData[rangeArrayKey];
  if (Array.isArray(rangeValue) && rangeValue.length >= 2) {
    const start = toFiniteNumber(rangeValue[0]);
    const end = toFiniteNumber(rangeValue[1]);
    if (start !== undefined && end !== undefined) {
      return { present: true, range: [start, end] };
    }
  }

  const start = toFiniteNumber(relayoutData[`${axisPrefix}.range[0]`]);
  const end = toFiniteNumber(relayoutData[`${axisPrefix}.range[1]`]);
  if (start !== undefined && end !== undefined) {
    return { present: true, range: [start, end] };
  }

  return { present: false };
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}
