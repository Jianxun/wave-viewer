import type { AxisId, AxisState, PlotState } from "../state/workspaceState";
import type { SidePanelTraceTuplePayload } from "../../core/dataset/types";

type PlotlyAxisRef = "y" | `y${number}`;

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
  fixedrange?: boolean;
};

export type PlotlyLayout = {
  margin: { l: number; r: number; t: number; b: number };
  showlegend: boolean;
  template?: "plotly_dark";
  paper_bgcolor?: string;
  plot_bgcolor?: string;
  font?: { color: string };
  dragmode?: "zoom";
  shapes?: Array<{
    type: "rect";
    xref: "paper";
    yref: "paper";
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    line: { color: string; width: number };
    fillcolor: "rgba(0,0,0,0)";
    layer: "below";
  }>;
  hovermode: "x unified" | "closest";
  legend: { orientation: "h"; y: number; x: number };
  xaxis: {
    title?: { text: string };
    anchor?: `y${number}` | "y";
    autorange?: boolean;
    range?: [number, number];
    rangeslider?: { visible: boolean; autorange?: boolean; range?: [number, number]; thickness?: number };
    automargin: boolean;
    fixedrange?: boolean;
  };
  [key: string]: unknown;
};

export type PlotlyFigure = {
  data: PlotlyTrace[];
  layout: PlotlyLayout;
};

export type AxisLaneDomain = {
  axisId: AxisId;
  domain: [number, number];
};

export type RenderAxisMapping = AxisLaneDomain & {
  laneIndex: number;
  traceRef: PlotlyAxisRef;
  layoutKey: string;
};

export function mapLaneIndexToPlotly(laneIndex: number): { traceRef: PlotlyAxisRef; layoutKey: string } {
  const suffix = laneIndex + 1;
  if (suffix === 1) {
    return { traceRef: "y", layoutKey: "yaxis" };
  }

  return { traceRef: `y${suffix}`, layoutKey: `yaxis${suffix}` };
}

export function buildRenderAxisMappings(axes: ReadonlyArray<Pick<AxisState, "id">>): RenderAxisMapping[] {
  const domains = buildLaneDomains(axes.length);
  return axes.map((axis, laneIndex) => ({
    axisId: axis.id,
    laneIndex,
    domain: domains[laneIndex] ?? [0, 1],
    ...mapLaneIndexToPlotly(laneIndex)
  }));
}

export function buildPlotlyFigure(payload: {
  plot: PlotState;
  traceTuplesBySourceId: ReadonlyMap<string, SidePanelTraceTuplePayload>;
}): PlotlyFigure {
  const firstTuple = payload.plot.traces
    .map((trace) => (trace.sourceId ? payload.traceTuplesBySourceId.get(trace.sourceId) : undefined))
    .find((entry) => entry !== undefined);
  const xBounds = getBounds(firstTuple?.x ?? []);
  const axisMappings = buildRenderAxisMappings(payload.plot.axes);
  const axisMappingById = new Map(axisMappings.map((mapping) => [mapping.axisId, mapping] as const));
  const defaultTraceAxisRef = axisMappings[0]?.traceRef ?? "y";
  const bottomLaneTraceAxisRef = axisMappings[axisMappings.length - 1]?.traceRef ?? "y";

  const data: PlotlyTrace[] = payload.plot.traces.map((trace) => {
    const tuple = trace.sourceId ? payload.traceTuplesBySourceId.get(trace.sourceId) : undefined;
    const axisMap = axisMappingById.get(trace.axisId);

    return {
      type: "scatter",
      mode: "lines",
      name: tuple?.yName ?? trace.signal,
      x: tuple?.x ?? [],
      y: tuple?.y ?? [],
      yaxis: axisMap?.traceRef ?? defaultTraceAxisRef,
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
    template: "plotly_dark",
    paper_bgcolor: "#101723",
    plot_bgcolor: "#101723",
    font: { color: "#e8edf8" },
    dragmode: "zoom",
    hovermode: "closest",
    legend: { orientation: "h", y: 1.08, x: 0 },
    xaxis: {
      title: { text: firstTuple?.xName ?? payload.plot.xSignal },
      anchor: bottomLaneTraceAxisRef,
      autorange: payload.plot.xRange === undefined,
      range: payload.plot.xRange,
      rangeslider: { visible: true, autorange: true, range: xBounds, thickness: 0.075 },
      automargin: true,
      fixedrange: false
    }
  };

  layout.shapes = buildLaneOutlineShapes(axisMappings.map((lane) => lane.domain));

  for (const [index, axis] of payload.plot.axes.entries()) {
    const mapping = axisMappings[index];
    if (!mapping) {
      continue;
    }
    layout[mapping.layoutKey] = toAxisLayout(axis, mapping.domain);
  }

  return { data, layout };
}

export function getAxisLaneDomains(axes: ReadonlyArray<Pick<AxisState, "id">>): AxisLaneDomain[] {
  return buildRenderAxisMappings(axes).map(({ axisId, domain }) => ({ axisId, domain }));
}

export function resolveAxisIdFromNormalizedY(
  axes: ReadonlyArray<Pick<AxisState, "id">>,
  normalizedY: number
): AxisId | undefined {
  if (axes.length === 0 || !Number.isFinite(normalizedY)) {
    return undefined;
  }

  const y = clampToDomain(normalizedY);
  const lanes = getAxisLaneDomains(axes);
  const matchingLane = lanes.find(({ domain }) => y >= domain[0] && y <= domain[1]);
  if (matchingLane) {
    return matchingLane.axisId;
  }

  let nearestLane = lanes[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const lane of lanes) {
    const [start, end] = lane.domain;
    const distance = y < start ? start - y : y > end ? y - end : 0;
    if (distance <= nearestDistance) {
      nearestDistance = distance;
      nearestLane = lane;
    }
  }

  return nearestLane.axisId;
}

function toAxisLayout(axis: AxisState, domain: [number, number] | undefined): PlotlyAxisLayout {
  return {
    title: axis.title ? { text: axis.title } : undefined,
    type: axis.scale === "log" ? "log" : "linear",
    range: axis.range,
    domain,
    anchor: "x",
    automargin: true,
    fixedrange: false
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

function buildLaneOutlineShapes(
  laneDomains: Array<[number, number]>
): NonNullable<PlotlyLayout["shapes"]> {
  return laneDomains.map(([y0, y1]) => ({
    type: "rect",
    xref: "paper",
    yref: "paper",
    x0: 0,
    x1: 1,
    y0,
    y1,
    line: { color: "#3b4f7f", width: 1 },
    fillcolor: "rgba(0,0,0,0)",
    layer: "below"
  }));
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
  const axisMappings = buildRenderAxisMappings(axes);

  for (const mapping of axisMappings) {
    const axisRead = readRangeUpdate(relayoutData, mapping.layoutKey);
    if (axisRead.present) {
      axisRanges.push({ axisId: mapping.axisId, range: axisRead.range });
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

function getBounds(values: number[]): [number, number] | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue;
    }
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return undefined;
  }

  return [min, max];
}
