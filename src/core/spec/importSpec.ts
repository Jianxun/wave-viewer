import * as path from "node:path";
import { parse } from "yaml";

import type {
  ImportPlotSpecInput,
  ImportPlotSpecResult,
  PlotSpecLaneV2,
  PlotSpecPlotV2,
  PlotSpecSignalRefV2,
  PlotSpecV2
} from "./plotSpecV1";
import { PLOT_SPEC_V2_VERSION, PlotSpecImportError } from "./plotSpecV1";

export function importPlotSpecV1(input: ImportPlotSpecInput): ImportPlotSpecResult {
  const parsed = parseYaml(input.yamlText);
  const spec = validateSpecShape(parsed);
  const availableSignalsByDatasetId = createAvailableSignalsLookup(
    spec,
    input.availableSignals
  );
  const datasetPathById = resolveDatasetPathById(spec.datasets, input.specPath);

  if (spec.plots.length === 0) {
    throw new PlotSpecImportError("Plot spec must include at least one plot in plots.");
  }

  const plotIds = new Set(spec.plots.map((plot) => plot.id));
  if (!plotIds.has(spec.active_plot)) {
    throw new PlotSpecImportError(`Active plot id ${spec.active_plot} is missing from plots.`);
  }

  const missingSignalsByPlot: string[] = [];
  const laneIdByAxisIdByPlotId: Record<string, Record<`y${number}`, string>> = {};
  const xDatasetPathByPlotId: Record<string, string> = {};

  const workspace = {
    activePlotId: spec.active_plot,
    plots: spec.plots.map((plot) => {
      const missingSignals = collectMissingSignals(plot, availableSignalsByDatasetId);
      if (missingSignals.length > 0) {
        missingSignalsByPlot.push(`plot ${plot.id} (${missingSignals.join("; ")})`);
      }
      laneIdByAxisIdByPlotId[plot.id] = toAxisLaneIdMap(plot);
      const workspacePlot = toWorkspacePlot(plot, datasetPathById);
      xDatasetPathByPlotId[plot.id] = datasetPathById[plot.x.dataset];
      return workspacePlot;
    })
  };

  if (missingSignalsByPlot.length > 0) {
    throw new PlotSpecImportError(`Missing signals in plot spec: ${missingSignalsByPlot.join("; ")}.`);
  }

  return {
    datasetPath: datasetPathById[spec.active_dataset],
    workspace,
    laneIdByAxisIdByPlotId,
    xDatasetPathByPlotId
  };
}

export function readPlotSpecDatasetPathV1(yamlText: string, specPath?: string): string {
  const parsed = parseYaml(yamlText);
  const spec = validateSpecShape(parsed);
  const datasetPathById = resolveDatasetPathById(spec.datasets, specPath);
  return datasetPathById[spec.active_dataset];
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

  if (!Array.isArray(parsed.datasets) || parsed.datasets.length === 0) {
    throw new PlotSpecImportError("Plot spec datasets must be a non-empty array.");
  }

  const datasets = parsed.datasets.map((entry, index) => validateDataset(entry, index));
  const datasetIds = new Set<string>();
  for (const dataset of datasets) {
    if (datasetIds.has(dataset.id)) {
      throw new PlotSpecImportError(`Plot spec datasets contains duplicate id '${dataset.id}'.`);
    }
    datasetIds.add(dataset.id);
  }

  if (typeof parsed.active_dataset !== "string" || parsed.active_dataset.trim().length === 0) {
    throw new PlotSpecImportError("Plot spec active_dataset must be a non-empty string.");
  }
  if (!datasetIds.has(parsed.active_dataset)) {
    throw new PlotSpecImportError(
      `Plot spec active_dataset '${parsed.active_dataset}' is missing from datasets.`
    );
  }

  if (typeof parsed.active_plot !== "string" || parsed.active_plot.trim().length === 0) {
    throw new PlotSpecImportError("Plot spec active_plot must be a non-empty string.");
  }

  if (!Array.isArray(parsed.plots)) {
    throw new PlotSpecImportError("Plot spec plots must be an array.");
  }

  const plots = parsed.plots.map((entry, index) => validatePlot(entry, index, datasetIds));

  return {
    version: PLOT_SPEC_V2_VERSION,
    datasets,
    active_dataset: parsed.active_dataset,
    active_plot: parsed.active_plot,
    plots
  };
}

function validateDataset(value: unknown, index: number): { id: string; path: string } {
  if (!isRecord(value)) {
    throw new PlotSpecImportError(`Dataset at index ${index} must be an object.`);
  }

  const { id, path: datasetPath } = value;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new PlotSpecImportError(`Dataset at index ${index} has invalid id.`);
  }
  if (typeof datasetPath !== "string" || datasetPath.trim().length === 0) {
    throw new PlotSpecImportError(`Dataset ${id} path must be a non-empty string.`);
  }

  return { id, path: datasetPath };
}

function validatePlot(value: unknown, index: number, datasetIds: Set<string>): PlotSpecPlotV2 {
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

  const xRef = validateSignalRef(
    x,
    `Plot ${id} x` as const,
    datasetIds
  );

  const normalized: PlotSpecPlotV2 = {
    id,
    name,
    x: xRef,
    y: []
  };

  if (isRecord(x) && x.label !== undefined) {
    if (typeof x.label !== "string") {
      throw new PlotSpecImportError(`Plot ${id} x.label must be a string when provided.`);
    }
    normalized.x.label = x.label;
  }

  if (isRecord(x) && x.range !== undefined) {
    normalized.x.range = parseNumberPair(x.range, `plot ${id} x.range`);
  }

  if (!Array.isArray(y) || y.length === 0) {
    throw new PlotSpecImportError(`Plot ${id} must include at least one lane in y.`);
  }

  normalized.y = y.map((lane, laneIndex) => validateLane(id, lane, laneIndex, datasetIds));

  return normalized;
}

function validateLane(
  plotId: string,
  value: unknown,
  laneIndex: number,
  datasetIds: Set<string>
): PlotSpecLaneV2 {
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

  for (const [traceLabel, signalRef] of Object.entries(signals)) {
    lane.signals[traceLabel] = validateSignalRef(
      signalRef,
      `Plot ${plotId} lane ${id} signal '${traceLabel}'` as const,
      datasetIds
    );
  }

  return lane;
}

function validateSignalRef(
  value: unknown,
  contextLabel: string,
  datasetIds: Set<string>
): PlotSpecSignalRefV2 {
  if (!isRecord(value)) {
    throw new PlotSpecImportError(`${contextLabel} must be an object with dataset and signal.`);
  }

  const { dataset, signal } = value;
  if (typeof dataset !== "string" || dataset.trim().length === 0) {
    throw new PlotSpecImportError(`${contextLabel}.dataset must be a non-empty string.`);
  }
  if (!datasetIds.has(dataset)) {
    throw new PlotSpecImportError(`${contextLabel}.dataset '${dataset}' is not declared in datasets.`);
  }
  if (typeof signal !== "string" || signal.trim().length === 0) {
    throw new PlotSpecImportError(`${contextLabel}.signal must be a non-empty string.`);
  }

  return { dataset, signal };
}

function toWorkspacePlot(
  plot: PlotSpecPlotV2,
  datasetPathById: Record<string, string>
) {
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
    return Object.entries(lane.signals).map(([traceLabel, signalRef]) => {
      traceCounter += 1;
      const traceId = createUniqueTraceId(traceLabel.trim() || `trace-${traceCounter}`, usedTraceIds);
      const sourceDatasetPath = datasetPathById[signalRef.dataset];
      return {
        id: traceId,
        signal: signalRef.signal,
        sourceId: `${sourceDatasetPath}::${signalRef.signal}`,
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

function toAxisLaneIdMap(plot: PlotSpecPlotV2): Record<`y${number}`, string> {
  const laneIds: Record<`y${number}`, string> = {};
  for (let laneIndex = 0; laneIndex < plot.y.length; laneIndex += 1) {
    const axisId = `y${laneIndex + 1}` as const;
    laneIds[axisId] = plot.y[laneIndex].id;
  }
  return laneIds;
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

function collectMissingSignals(
  plot: PlotSpecPlotV2,
  availableSignalsByDatasetId: Map<string, Set<string>>
): string[] {
  const missing = new Set<string>();

  if (isSignalMissing(plot.x.dataset, plot.x.signal, availableSignalsByDatasetId)) {
    missing.add(`x.${plot.x.dataset}: ${plot.x.signal}`);
  }

  for (const lane of plot.y) {
    for (const signalRef of Object.values(lane.signals)) {
      if (isSignalMissing(signalRef.dataset, signalRef.signal, availableSignalsByDatasetId)) {
        missing.add(`y.${lane.id}.${signalRef.dataset}: ${signalRef.signal}`);
      }
    }
  }

  return [...missing.values()];
}

function isSignalMissing(
  datasetId: string,
  signal: string,
  availableSignalsByDatasetId: Map<string, Set<string>>
): boolean {
  const available = availableSignalsByDatasetId.get(datasetId);
  if (!available) {
    return false;
  }
  return !available.has(signal);
}

function createAvailableSignalsLookup(
  spec: PlotSpecV2,
  input: ImportPlotSpecInput["availableSignals"]
): Map<string, Set<string>> {
  const byDatasetId = new Map<string, Set<string>>();
  if (Array.isArray(input)) {
    byDatasetId.set(spec.active_dataset, new Set(input));
    return byDatasetId;
  }

  for (const [datasetId, signals] of Object.entries(input)) {
    byDatasetId.set(datasetId, new Set(signals));
  }
  return byDatasetId;
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

function resolveDatasetPathById(
  datasets: Array<{ id: string; path: string }>,
  specPath?: string
): Record<string, string> {
  const byId: Record<string, string> = {};
  for (const dataset of datasets) {
    byId[dataset.id] = resolveDatasetPath(dataset.path, specPath);
  }
  return byId;
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
