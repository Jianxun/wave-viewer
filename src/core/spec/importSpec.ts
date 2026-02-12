import { parse } from "yaml";

import type {
  ImportPlotSpecInput,
  ImportPlotSpecResult,
  PlotSpecAxisV1,
  PlotSpecPlotV1,
  PlotSpecTraceV1,
  PlotSpecTraceTupleV1,
  PlotSpecPersistenceMode,
  PlotSpecV1
} from "./plotSpecV1";
import {
  PLOT_SPEC_V1_VERSION,
  PORTABLE_ARCHIVE_SPEC_MODE,
  PlotSpecImportError,
  REFERENCE_ONLY_SPEC_MODE
} from "./plotSpecV1";

export function importPlotSpecV1(input: ImportPlotSpecInput): ImportPlotSpecResult {
  const parsed = parseYaml(input.yamlText);
  const spec = validateSpecShape(parsed);

  if (spec.workspace.plots.length === 0) {
    throw new PlotSpecImportError("Plot spec must include at least one plot in workspace.plots.");
  }

  const plotIds = new Set(spec.workspace.plots.map((plot) => plot.id));
  if (!plotIds.has(spec.workspace.activePlotId)) {
    throw new PlotSpecImportError(
      `Active plot id ${spec.workspace.activePlotId} is missing from workspace.plots.`
    );
  }

  const workspace = {
    activePlotId: spec.workspace.activePlotId,
    plots: spec.workspace.plots.map((plot) => toWorkspacePlot(plot))
  };
  const traceTupleBySourceId = buildTraceTupleBySourceId(spec);

  if (spec.mode === REFERENCE_ONLY_SPEC_MODE) {
    assertReferenceSignalsExist(spec.workspace.plots, input.availableSignals);
  } else {
    assertPortableArchiveTraceCoverage(spec.workspace.plots, traceTupleBySourceId);
  }

  return {
    mode: spec.mode,
    datasetPath: spec.dataset.path,
    workspace,
    traceTupleBySourceId
  };
}

function parseYaml(yamlText: string): unknown {
  try {
    return parse(yamlText);
  } catch (error) {
    throw new PlotSpecImportError(`Failed to parse YAML spec: ${getErrorMessage(error)}`);
  }
}

function validateSpecShape(parsed: unknown): PlotSpecV1 {
  if (!isRecord(parsed)) {
    throw new PlotSpecImportError("Plot spec root must be a YAML mapping.");
  }

  if (parsed.version !== PLOT_SPEC_V1_VERSION) {
    throw new PlotSpecImportError(`Unsupported plot spec version: ${String(parsed.version)}.`);
  }

  if (
    parsed.mode !== REFERENCE_ONLY_SPEC_MODE &&
    parsed.mode !== PORTABLE_ARCHIVE_SPEC_MODE
  ) {
    if (parsed.mode === undefined) {
      throw new PlotSpecImportError(
        "Plot spec mode must be explicitly set to 'reference-only' or 'portable-archive'."
      );
    }
    throw new PlotSpecImportError(`Unsupported plot spec mode: ${String(parsed.mode)}.`);
  }

  const dataset = parsed.dataset;
  if (!isRecord(dataset) || typeof dataset.path !== "string" || dataset.path.trim().length === 0) {
    throw new PlotSpecImportError("Plot spec dataset.path must be a non-empty string.");
  }

  const workspace = parsed.workspace;
  if (!isRecord(workspace)) {
    throw new PlotSpecImportError("Plot spec workspace must be an object.");
  }

  if (typeof workspace.activePlotId !== "string" || workspace.activePlotId.trim().length === 0) {
    throw new PlotSpecImportError("Plot spec workspace.activePlotId must be a non-empty string.");
  }

  if (!Array.isArray(workspace.plots)) {
    throw new PlotSpecImportError("Plot spec workspace.plots must be an array.");
  }

  const plots = workspace.plots.map((entry, index) => validatePlot(entry, index));

  const mode = parsed.mode as PlotSpecPersistenceMode;
  const archive = mode === PORTABLE_ARCHIVE_SPEC_MODE ? validateArchive(parsed.archive) : undefined;

  return {
    version: PLOT_SPEC_V1_VERSION,
    mode,
    dataset: {
      path: dataset.path
    },
    workspace: {
      activePlotId: workspace.activePlotId,
      plots
    },
    ...(archive ? { archive } : {})
  };
}

function validatePlot(value: unknown, index: number): PlotSpecPlotV1 {
  if (!isRecord(value)) {
    throw new PlotSpecImportError(`Plot at index ${index} must be an object.`);
  }

  const { id, name, xSignal, axes, traces, xRange } = value;

  if (typeof id !== "string" || id.trim().length === 0) {
    throw new PlotSpecImportError(`Plot at index ${index} has an invalid id.`);
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new PlotSpecImportError(`Plot ${id} has an invalid name.`);
  }
  if (typeof xSignal !== "string" || xSignal.trim().length === 0) {
    throw new PlotSpecImportError(`Plot ${id} has an invalid xSignal.`);
  }
  if (!Array.isArray(axes) || axes.length === 0) {
    throw new PlotSpecImportError(`Plot ${id} must include at least one axis.`);
  }
  if (!Array.isArray(traces)) {
    throw new PlotSpecImportError(`Plot ${id} traces must be an array.`);
  }

  const parsedAxes = axes.map((axis, axisIndex) => validateAxis(id, axis, axisIndex));
  const axisIds = new Set(parsedAxes.map((axis) => axis.id));
  if (axisIds.size !== parsedAxes.length) {
    throw new PlotSpecImportError(`Plot ${id} contains duplicate axis ids.`);
  }

  const parsedTraces = traces.map((trace, traceIndex) => validateTrace(id, trace, traceIndex));
  for (const trace of parsedTraces) {
    if (!axisIds.has(trace.axisId)) {
      throw new PlotSpecImportError(
        `Plot ${id} trace ${trace.id} references unknown axis ${trace.axisId}.`
      );
    }
  }

  const normalized: PlotSpecPlotV1 = {
    id,
    name,
    xSignal,
    axes: parsedAxes,
    traces: parsedTraces
  };

  if (xRange !== undefined) {
    normalized.xRange = parseNumberPair(xRange, `plot ${id} xRange`);
  }

  return normalized;
}

function validateAxis(plotId: string, value: unknown, index: number): PlotSpecAxisV1 {
  if (!isRecord(value)) {
    throw new PlotSpecImportError(`Plot ${plotId} axis at index ${index} must be an object.`);
  }

  const { id, side, title, range, scale } = value;
  if (!isAxisId(id)) {
    throw new PlotSpecImportError(`Plot ${plotId} axis at index ${index} has invalid id.`);
  }
  if (side !== undefined) {
    throw new PlotSpecImportError(
      `Plot ${plotId} axis ${id} uses legacy field side. Re-export this workspace with the current Wave Viewer version.`
    );
  }

  const axis: PlotSpecAxisV1 = {
    id
  };

  if (title !== undefined) {
    if (typeof title !== "string") {
      throw new PlotSpecImportError(`Plot ${plotId} axis ${id} has invalid title.`);
    }
    axis.title = title;
  }

  if (range !== undefined) {
    axis.range = parseNumberPair(range, `plot ${plotId} axis ${id} range`);
  }

  if (scale !== undefined) {
    if (scale !== "linear" && scale !== "log") {
      throw new PlotSpecImportError(`Plot ${plotId} axis ${id} has invalid scale.`);
    }
    axis.scale = scale;
  }

  return axis;
}

function validateTrace(plotId: string, value: unknown, index: number): PlotSpecTraceV1 {
  if (!isRecord(value)) {
    throw new PlotSpecImportError(`Plot ${plotId} trace at index ${index} must be an object.`);
  }

  const { id, signal, sourceId, axisId, visible, color, lineWidth } = value;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new PlotSpecImportError(`Plot ${plotId} trace at index ${index} has invalid id.`);
  }
  if (typeof signal !== "string" || signal.trim().length === 0) {
    throw new PlotSpecImportError(`Plot ${plotId} trace ${id} has invalid signal.`);
  }
  if (!isAxisId(axisId)) {
    throw new PlotSpecImportError(`Plot ${plotId} trace ${id} has invalid axisId.`);
  }
  if (typeof visible !== "boolean") {
    throw new PlotSpecImportError(`Plot ${plotId} trace ${id} has invalid visible value.`);
  }

  const trace: PlotSpecTraceV1 = {
    id,
    signal,
    axisId,
    visible
  };
  if (sourceId !== undefined) {
    if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
      throw new PlotSpecImportError(`Plot ${plotId} trace ${id} has invalid sourceId.`);
    }
    trace.sourceId = sourceId;
  }

  if (color !== undefined) {
    if (typeof color !== "string") {
      throw new PlotSpecImportError(`Plot ${plotId} trace ${id} has invalid color.`);
    }
    trace.color = color;
  }

  if (lineWidth !== undefined) {
    if (typeof lineWidth !== "number" || !Number.isFinite(lineWidth)) {
      throw new PlotSpecImportError(`Plot ${plotId} trace ${id} has invalid lineWidth.`);
    }
    trace.lineWidth = lineWidth;
  }

  return trace;
}

function validateArchive(value: unknown): { traces: PlotSpecTraceTupleV1[] } {
  if (!isRecord(value)) {
    throw new PlotSpecImportError(
      "Plot spec archive must be an object for 'portable-archive' mode."
    );
  }
  if (!Array.isArray(value.traces)) {
    throw new PlotSpecImportError(
      "Plot spec archive.traces must be an array for 'portable-archive' mode."
    );
  }

  const traces = value.traces.map((entry, index) => validateArchiveTraceTuple(entry, index));
  const sourceIds = new Set<string>();
  for (const trace of traces) {
    if (sourceIds.has(trace.sourceId)) {
      throw new PlotSpecImportError(
        `Plot spec archive contains duplicate sourceId '${trace.sourceId}'.`
      );
    }
    sourceIds.add(trace.sourceId);
  }
  return { traces };
}

function validateArchiveTraceTuple(value: unknown, index: number): PlotSpecTraceTupleV1 {
  if (!isRecord(value)) {
    throw new PlotSpecImportError(`Plot spec archive trace at index ${index} must be an object.`);
  }

  const { sourceId, datasetPath, xName, yName, x, y } = value;
  if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
    throw new PlotSpecImportError(`Plot spec archive trace at index ${index} has invalid sourceId.`);
  }
  if (typeof datasetPath !== "string" || datasetPath.trim().length === 0) {
    throw new PlotSpecImportError(
      `Plot spec archive trace ${sourceId} has invalid datasetPath.`
    );
  }
  if (typeof xName !== "string" || xName.trim().length === 0) {
    throw new PlotSpecImportError(`Plot spec archive trace ${sourceId} has invalid xName.`);
  }
  if (typeof yName !== "string" || yName.trim().length === 0) {
    throw new PlotSpecImportError(`Plot spec archive trace ${sourceId} has invalid yName.`);
  }

  const parsedX = parseFiniteNumericArray(x, `plot spec archive trace ${sourceId} x`);
  const parsedY = parseFiniteNumericArray(y, `plot spec archive trace ${sourceId} y`);
  if (parsedX.length !== parsedY.length) {
    throw new PlotSpecImportError(
      `Plot spec archive trace ${sourceId} x and y must have the same length.`
    );
  }

  return {
    sourceId,
    datasetPath,
    xName,
    yName,
    x: parsedX,
    y: parsedY
  };
}

function toWorkspacePlot(plot: PlotSpecPlotV1) {
  const maxAxisNumber = plot.axes.reduce((max, axis) => {
    const nextValue = Number.parseInt(axis.id.slice(1), 10);
    return Number.isFinite(nextValue) && nextValue > max ? nextValue : max;
  }, 0);

  return {
    id: plot.id,
    name: plot.name,
    xSignal: plot.xSignal,
    axes: plot.axes,
    traces: plot.traces,
    nextAxisNumber: maxAxisNumber + 1,
    ...(plot.xRange !== undefined ? { xRange: plot.xRange } : {})
  };
}

function collectMissingTraceSignals(plot: PlotSpecPlotV1, availableSignals: Set<string>): string[] {
  const missing = new Set<string>();
  for (const trace of plot.traces) {
    if (!availableSignals.has(trace.signal)) {
      missing.add(trace.signal);
    }
  }
  return [...missing.values()];
}

function assertReferenceSignalsExist(plots: PlotSpecPlotV1[], availableSignalsList: string[]): void {
  const availableSignals = new Set(availableSignalsList);
  const missingSignalsByPlot: string[] = [];

  for (const plot of plots) {
    if (!availableSignals.has(plot.xSignal)) {
      const missingTraceSignals = collectMissingTraceSignals(plot, availableSignals);
      const details =
        missingTraceSignals.length > 0
          ? `xSignal: ${plot.xSignal}; traces: ${missingTraceSignals.join(", ")}`
          : `xSignal: ${plot.xSignal}`;
      missingSignalsByPlot.push(`plot ${plot.id} (${details})`);
      continue;
    }

    const missingTraceSignals = collectMissingTraceSignals(plot, availableSignals);
    if (missingTraceSignals.length > 0) {
      missingSignalsByPlot.push(`plot ${plot.id} (traces: ${missingTraceSignals.join(", ")})`);
    }
  }

  if (missingSignalsByPlot.length > 0) {
    throw new PlotSpecImportError(`Missing signals in plot spec: ${missingSignalsByPlot.join("; ")}.`);
  }
}

function assertPortableArchiveTraceCoverage(
  plots: PlotSpecPlotV1[],
  traceTupleBySourceId: Map<string, PlotSpecTraceTupleV1>
): void {
  for (const plot of plots) {
    for (const trace of plot.traces) {
      if (!trace.sourceId) {
        throw new PlotSpecImportError(
          `Plot ${plot.id} trace ${trace.id} is missing sourceId required for 'portable-archive' mode.`
        );
      }
      const tuple = traceTupleBySourceId.get(trace.sourceId);
      if (!tuple) {
        throw new PlotSpecImportError(
          `Plot ${plot.id} trace ${trace.id} references sourceId '${trace.sourceId}' missing from archive.traces.`
        );
      }
      if (tuple.yName !== trace.signal) {
        throw new PlotSpecImportError(
          `Plot ${plot.id} trace ${trace.id} signal '${trace.signal}' does not match archived tuple yName '${tuple.yName}'.`
        );
      }
    }
  }
}

function buildTraceTupleBySourceId(spec: PlotSpecV1): Map<string, PlotSpecTraceTupleV1> {
  if (spec.mode !== PORTABLE_ARCHIVE_SPEC_MODE || !spec.archive) {
    return new Map<string, PlotSpecTraceTupleV1>();
  }
  return new Map(spec.archive.traces.map((trace) => [trace.sourceId, trace]));
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

function parseFiniteNumericArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new PlotSpecImportError(`${label} must be an array.`);
  }
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw new PlotSpecImportError(`${label} must contain finite numeric values.`);
    }
  }
  return value.slice();
}

function isAxisId(value: unknown): value is `y${number}` {
  return typeof value === "string" && /^y[1-9]\d*$/.test(value);
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
