import { parse } from "yaml";

import type {
  ImportPlotSpecInput,
  ImportPlotSpecResult,
  PlotSpecAxisV1,
  PlotSpecPlotV1,
  PlotSpecTraceV1,
  PlotSpecV1
} from "./plotSpecV1";
import { PLOT_SPEC_V1_VERSION, PlotSpecImportError } from "./plotSpecV1";

export function importPlotSpecV1(input: ImportPlotSpecInput): ImportPlotSpecResult {
  const parsed = parseYaml(input.yamlText);
  const spec = validateSpecShape(parsed);
  const availableSignals = new Set(input.availableSignals);

  if (spec.workspace.plots.length === 0) {
    throw new PlotSpecImportError("Plot spec must include at least one plot in workspace.plots.");
  }

  const plotIds = new Set(spec.workspace.plots.map((plot) => plot.id));
  if (!plotIds.has(spec.workspace.activePlotId)) {
    throw new PlotSpecImportError(
      `Active plot id ${spec.workspace.activePlotId} is missing from workspace.plots.`
    );
  }

  const missingSignalsByPlot: string[] = [];

  const workspace = {
    activePlotId: spec.workspace.activePlotId,
    plots: spec.workspace.plots.map((plot) => {
      if (!availableSignals.has(plot.xSignal)) {
        const missingTraceSignals = collectMissingTraceSignals(plot, availableSignals);
        const details =
          missingTraceSignals.length > 0
            ? `xSignal: ${plot.xSignal}; traces: ${missingTraceSignals.join(", ")}`
            : `xSignal: ${plot.xSignal}`;
        missingSignalsByPlot.push(`plot ${plot.id} (${details})`);
      } else {
        const missingTraceSignals = collectMissingTraceSignals(plot, availableSignals);
        if (missingTraceSignals.length > 0) {
          missingSignalsByPlot.push(`plot ${plot.id} (traces: ${missingTraceSignals.join(", ")})`);
        }
      }

      return toWorkspacePlot(plot);
    })
  };

  if (missingSignalsByPlot.length > 0) {
    throw new PlotSpecImportError(`Missing signals in plot spec: ${missingSignalsByPlot.join("; ")}.`);
  }

  return {
    datasetPath: spec.dataset.path,
    workspace
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

  return {
    version: PLOT_SPEC_V1_VERSION,
    dataset: {
      path: dataset.path
    },
    workspace: {
      activePlotId: workspace.activePlotId,
      plots
    }
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
  if (side !== "left" && side !== "right") {
    throw new PlotSpecImportError(`Plot ${plotId} axis ${id} has invalid side.`);
  }

  const axis: PlotSpecAxisV1 = {
    id,
    side
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

  const { id, signal, axisId, visible, color, lineWidth } = value;
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
