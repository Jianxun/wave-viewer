import * as path from "node:path";
import { parse } from "yaml";

import type {
  ImportPlotSpecInput,
  ImportPlotSpecResult,
  PlotSpecLaneV2,
  PlotSpecPlotV2,
  PlotSpecV2
} from "./plotSpecV1";
import { PLOT_SPEC_V2_VERSION, PlotSpecImportError } from "./plotSpecV1";

export function importPlotSpecV1(input: ImportPlotSpecInput): ImportPlotSpecResult {
  const parsed = parseYaml(input.yamlText);
  const spec = validateSpecShape(parsed);
  const availableSignals = new Set(input.availableSignals);

  if (spec.plots.length === 0) {
    throw new PlotSpecImportError("Plot spec must include at least one plot in plots.");
  }

  const plotIds = new Set(spec.plots.map((plot) => plot.id));
  if (!plotIds.has(spec.active_plot)) {
    throw new PlotSpecImportError(`Active plot id ${spec.active_plot} is missing from plots.`);
  }

  const missingSignalsByPlot: string[] = [];

  const workspace = {
    activePlotId: spec.active_plot,
    plots: spec.plots.map((plot) => {
      const missingSignals = collectMissingSignals(plot, availableSignals);
      if (missingSignals.length > 0) {
        missingSignalsByPlot.push(`plot ${plot.id} (${missingSignals.join("; ")})`);
      }
      return toWorkspacePlot(plot);
    })
  };

  if (missingSignalsByPlot.length > 0) {
    throw new PlotSpecImportError(`Missing signals in plot spec: ${missingSignalsByPlot.join("; ")}.`);
  }

  return {
    datasetPath: resolveDatasetPath(spec.dataset.path, input.specPath),
    workspace
  };
}

export function readPlotSpecDatasetPathV1(yamlText: string, specPath?: string): string {
  const parsed = parseYaml(yamlText);
  const spec = validateSpecShape(parsed);
  return resolveDatasetPath(spec.dataset.path, specPath);
}

function parseYaml(yamlText: string): unknown {
  try {
    return parse(yamlText);
  } catch (error) {
    throw new PlotSpecImportError(`Failed to parse YAML spec: ${getErrorMessage(error)}`);
  }
}

function validateSpecShape(parsed: unknown): PlotSpecV2 {
  if (!isRecord(parsed)) {
    throw new PlotSpecImportError("Plot spec root must be a YAML mapping.");
  }

  if (parsed.version !== PLOT_SPEC_V2_VERSION) {
    throw new PlotSpecImportError(
      `Unsupported plot spec version: ${String(parsed.version)}. Supported version is 2.`
    );
  }

  if (Object.hasOwn(parsed, "mode")) {
    throw new PlotSpecImportError("Plot spec mode is not supported in v2 layout schema.");
  }

  const dataset = parsed.dataset;
  if (!isRecord(dataset) || typeof dataset.path !== "string" || dataset.path.trim().length === 0) {
    throw new PlotSpecImportError("Plot spec dataset.path must be a non-empty string.");
  }

  if (typeof parsed.active_plot !== "string" || parsed.active_plot.trim().length === 0) {
    throw new PlotSpecImportError("Plot spec active_plot must be a non-empty string.");
  }

  if (!Array.isArray(parsed.plots)) {
    throw new PlotSpecImportError("Plot spec plots must be an array.");
  }

  const plots = parsed.plots.map((entry, index) => validatePlot(entry, index));

  return {
    version: PLOT_SPEC_V2_VERSION,
    dataset: {
      path: dataset.path
    },
    active_plot: parsed.active_plot,
    plots
  };
}

function validatePlot(value: unknown, index: number): PlotSpecPlotV2 {
  if (!isRecord(value)) {
    throw new PlotSpecImportError(`Plot at index ${index} must be an object.`);
  }

  const { id, name, x, y } = value;

  if (typeof id !== "string" || id.trim().length === 0) {
    throw new PlotSpecImportError(`Plot at index ${index} has an invalid id.`);
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new PlotSpecImportError(`Plot ${id} has an invalid name.`);
  }
  if (!isRecord(x)) {
    throw new PlotSpecImportError(`Plot ${id} x must be an object.`);
  }
  if (typeof x.signal !== "string" || x.signal.trim().length === 0) {
    throw new PlotSpecImportError(`Plot ${id} x.signal must be a non-empty string.`);
  }
  if (x.label !== undefined && typeof x.label !== "string") {
    throw new PlotSpecImportError(`Plot ${id} x.label must be a string when provided.`);
  }

  const normalized: PlotSpecPlotV2 = {
    id,
    name,
    x: {
      signal: x.signal
    },
    y: []
  };

  if (x.label !== undefined) {
    normalized.x.label = x.label;
  }

  if (x.range !== undefined) {
    normalized.x.range = parseNumberPair(x.range, `plot ${id} x.range`);
  }

  if (!Array.isArray(y) || y.length === 0) {
    throw new PlotSpecImportError(`Plot ${id} must include at least one lane in y.`);
  }

  normalized.y = y.map((lane, laneIndex) => validateLane(id, lane, laneIndex));

  return normalized;
}

function validateLane(plotId: string, value: unknown, laneIndex: number): PlotSpecLaneV2 {
  if (!isRecord(value)) {
    throw new PlotSpecImportError(`Plot ${plotId} lane at index ${laneIndex} must be an object.`);
  }

  const { id, label, range, scale, signals } = value;

  if (typeof id !== "string" || id.trim().length === 0) {
    throw new PlotSpecImportError(`Plot ${plotId} lane at index ${laneIndex} has invalid id.`);
  }

  const lane: PlotSpecLaneV2 = {
    id,
    signals: {}
  };

  if (label !== undefined) {
    if (typeof label !== "string") {
      throw new PlotSpecImportError(`Plot ${plotId} lane ${id} has invalid label.`);
    }
    lane.label = label;
  }

  if (range !== undefined) {
    lane.range = parseNumberPair(range, `plot ${plotId} lane ${id} range`);
  }

  if (scale !== undefined) {
    if (scale !== "linear" && scale !== "log") {
      throw new PlotSpecImportError(`Plot ${plotId} lane ${id} has invalid scale.`);
    }
    lane.scale = scale;
  }

  if (!isRecord(signals)) {
    throw new PlotSpecImportError(`Plot ${plotId} lane ${id} signals must be a mapping.`);
  }

  for (const [traceLabel, signal] of Object.entries(signals)) {
    if (typeof signal !== "string" || signal.trim().length === 0) {
      throw new PlotSpecImportError(`Plot ${plotId} lane ${id} has invalid signal entry '${traceLabel}'.`);
    }
    lane.signals[traceLabel] = signal;
  }

  return lane;
}

function toWorkspacePlot(plot: PlotSpecPlotV2) {
  const usedTraceIds = new Set<string>();
  let traceCounter = 0;

  const axes = plot.y.map((lane, laneIndex) => {
    const axis: {
      id: `y${number}`;
      title?: string;
      range?: [number, number];
      scale?: "linear" | "log";
    } = {
      id: `y${laneIndex + 1}` as const
    };

    if (lane.label !== undefined) {
      axis.title = lane.label;
    }
    if (lane.range !== undefined) {
      axis.range = lane.range;
    }
    if (lane.scale !== undefined) {
      axis.scale = lane.scale;
    }

    return axis;
  });

  const traces = plot.y.flatMap((lane, laneIndex) => {
    const axisId = `y${laneIndex + 1}` as const;
    return Object.entries(lane.signals).map(([traceLabel, signal]) => {
      traceCounter += 1;
      const traceId = createUniqueTraceId(traceLabel.trim() || `trace-${traceCounter}`, usedTraceIds);
      return {
        id: traceId,
        signal,
        axisId,
        visible: true
      };
    });
  });

  return {
    id: plot.id,
    name: plot.name,
    xSignal: plot.x.signal,
    axes,
    traces,
    nextAxisNumber: axes.length + 1,
    ...(plot.x.range !== undefined ? { xRange: plot.x.range } : {})
  };
}

function createUniqueTraceId(candidateId: string, usedIds: Set<string>): string {
  if (!usedIds.has(candidateId)) {
    usedIds.add(candidateId);
    return candidateId;
  }

  let suffix = 2;
  while (usedIds.has(`${candidateId}-${suffix}`)) {
    suffix += 1;
  }

  const nextId = `${candidateId}-${suffix}`;
  usedIds.add(nextId);
  return nextId;
}

function collectMissingSignals(plot: PlotSpecPlotV2, availableSignals: Set<string>): string[] {
  const missing = new Set<string>();

  if (!availableSignals.has(plot.x.signal)) {
    missing.add(`x.signal: ${plot.x.signal}`);
  }

  for (const lane of plot.y) {
    for (const signal of Object.values(lane.signals)) {
      if (!availableSignals.has(signal)) {
        missing.add(`y.${lane.id}: ${signal}`);
      }
    }
  }

  return [...missing.values()];
}

function parseNumberPair(value: unknown, label: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new PlotSpecImportError(`${label} must be a [min, max] tuple.`);
  }

  const left = value[0];
  const right = value[1];
  if (typeof left !== "number" || typeof right !== "number") {
    throw new PlotSpecImportError(`${label} must contain numeric values.`);
  }

  return [left, right];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Invalid YAML document.";
}

function resolveDatasetPath(datasetPath: string, specPath?: string): string {
  if (path.isAbsolute(datasetPath)) {
    return path.resolve(datasetPath);
  }
  if (!specPath) {
    throw new PlotSpecImportError(
      "Plot spec dataset.path is relative but no spec file path was provided for resolution."
    );
  }
  return path.resolve(path.dirname(specPath), datasetPath);
}
