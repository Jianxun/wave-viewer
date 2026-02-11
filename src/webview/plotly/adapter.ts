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
  type?: "linear" | "log";
  range?: [number, number];
  domain?: [number, number];
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
    rangeslider?: { visible: boolean };
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
      rangeslider: { visible: true },
      automargin: true
    }
  };

  const laneDomains = buildLaneDomains(payload.plot.axes.length);
  for (const [index, axis] of payload.plot.axes.entries()) {
    const mapping = mapAxisIdToPlotly(axis.id);
    layout[mapping.layoutKey] = toAxisLayout(axis, laneDomains[index]);
  }

  return { data, layout };
}

function toAxisLayout(axis: AxisState, domain: [number, number] | undefined): PlotlyAxisLayout {
  return {
    title: axis.title ? { text: axis.title } : undefined,
    type: axis.scale === "log" ? "log" : "linear",
    range: axis.range,
    domain,
    anchor: "x",
    automargin: true
  };
}

function buildLaneDomains(laneCount: number): Array<[number, number]> {
  if (laneCount <= 0) {
    return [];
  }

  if (laneCount === 1) {
    return [[0, 1]];
  }

  const gap = 0.04;
  const laneHeight = (1 - gap * (laneCount - 1)) / laneCount;
  const domains: Array<[number, number]> = [];

  for (let index = 0; index < laneCount; index += 1) {
    const top = 1 - index * (laneHeight + gap);
    const bottom = top - laneHeight;
    domains.push([clampToDomain(bottom), clampToDomain(top)]);
  }

  return domains;
}

function clampToDomain(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
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
