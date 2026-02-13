import * as path from "node:path";
import { stringify } from "yaml";

import type { ExportPlotSpecInput, PlotSpecLaneV2, PlotSpecPlotV2, PlotSpecV2 } from "./plotSpecV1";
import { PLOT_SPEC_V2_VERSION } from "./plotSpecV1";

export function exportPlotSpecV1(input: ExportPlotSpecInput): string {
  const registry = createDatasetRegistry(input.datasetPath);

  for (const plot of input.workspace.plots) {
    for (const trace of plot.traces) {
      registry.register(getTraceDatasetPath(trace.sourceId, input.datasetPath));
    }
  }

  const activeDatasetId = registry.idFor(input.datasetPath);
  const spec: PlotSpecV2 = {
    version: PLOT_SPEC_V2_VERSION,
    datasets: registry.entries().map((entry) => ({
      id: entry.id,
      path: serializeDatasetPath(entry.path, input.specPath)
    })),
    active_dataset: activeDatasetId,
    active_plot: input.workspace.activePlotId,
    plots: input.workspace.plots.map((plot) => {
      const lanesByAxisId = new Map<string, PlotSpecLaneV2>();
      const laneIdByAxisId = input.laneIdByAxisIdByPlotId?.[plot.id] ?? {};
      const usedLaneIds = new Set<string>();

      for (let axisIndex = 0; axisIndex < plot.axes.length; axisIndex += 1) {
        const axis = plot.axes[axisIndex];
        const lane: PlotSpecLaneV2 = {
          id: toLaneId(
            laneIdByAxisId[axis.id],
            axisIndex,
            usedLaneIds
          ),
          signals: {}
        };

        if (axis.title !== undefined) {
          lane.label = axis.title;
        }
        if (axis.range !== undefined) {
          lane.range = axis.range;
        }
        if (axis.scale !== undefined) {
          lane.scale = axis.scale;
        }

        lanesByAxisId.set(axis.id, lane);
      }

      for (const trace of plot.traces) {
        const lane = lanesByAxisId.get(trace.axisId);
        if (!lane) {
          continue;
        }

        const traceLabel = trace.id.trim().length > 0 ? trace.id : `trace-${Object.keys(lane.signals).length + 1}`;
        const datasetPath = getTraceDatasetPath(trace.sourceId, input.datasetPath);
        lane.signals[traceLabel] = {
          dataset: registry.idFor(datasetPath),
          signal: trace.signal
        };
      }

      const specPlot: PlotSpecPlotV2 = {
        id: plot.id,
        name: plot.name,
        x: {
          dataset: activeDatasetId,
          signal: plot.xSignal
        },
        y: [...lanesByAxisId.values()]
      };

      if (plot.xRange !== undefined) {
        specPlot.x.range = plot.xRange;
      }

      return specPlot;
    })
  };

  const yamlText = stringify(spec, {
    indent: 2,
    lineWidth: 0
  });
  return yamlText.endsWith("\n") ? yamlText : `${yamlText}\n`;
}

const WINDOWS_ABSOLUTE_PATH_PREFIX = /^(?:[a-zA-Z]:[\\/]|\\\\)/;

function serializeDatasetPath(datasetPath: string, specPath?: string): string {
  if (!specPath) {
    return datasetPath;
  }

  const pathImpl = selectPathModule(datasetPath, specPath);
  const absoluteDatasetPath = pathImpl.resolve(datasetPath);
  const relativePath = pathImpl.relative(pathImpl.dirname(pathImpl.resolve(specPath)), absoluteDatasetPath);
  if (pathImpl.isAbsolute(relativePath)) {
    return normalizePathSeparators(relativePath);
  }
  const normalizedPath = normalizePathSeparators(relativePath);
  if (normalizedPath.length === 0) {
    return `./${pathImpl.basename(absoluteDatasetPath)}`;
  }
  return normalizedPath.startsWith(".") ? normalizedPath : `./${normalizedPath}`;
}

function selectPathModule(
  datasetPath: string,
  specPath: string
): typeof path.win32 | typeof path.posix {
  return isWindowsPathLike(datasetPath) || isWindowsPathLike(specPath) ? path.win32 : path.posix;
}

function isWindowsPathLike(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_PATH_PREFIX.test(filePath);
}

function normalizePathSeparators(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function toLaneId(
  candidate: string | undefined,
  axisIndex: number,
  usedLaneIds: Set<string>
): string {
  const trimmed = candidate?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : `lane-${axisIndex + 1}`;
  if (!usedLaneIds.has(base)) {
    usedLaneIds.add(base);
    return base;
  }
  let suffix = 2;
  while (usedLaneIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  const unique = `${base}-${suffix}`;
  usedLaneIds.add(unique);
  return unique;
}

function getTraceDatasetPath(sourceId: string | undefined, fallbackPath: string): string {
  if (!sourceId) {
    return fallbackPath;
  }
  const separatorIndex = sourceId.lastIndexOf("::");
  if (separatorIndex <= 0) {
    return fallbackPath;
  }
  const candidate = sourceId.slice(0, separatorIndex).trim();
  return candidate.length > 0 ? candidate : fallbackPath;
}

function createDatasetRegistry(activeDatasetPath: string): {
  register(datasetPath: string): string;
  idFor(datasetPath: string): string;
  entries(): Array<{ id: string; path: string }>;
} {
  const idByPath = new Map<string, string>();
  const entries: Array<{ id: string; path: string }> = [];

  const register = (datasetPath: string): string => {
    const normalized = datasetPath.trim();
    if (normalized.length === 0) {
      return register(activeDatasetPath);
    }

    const existing = idByPath.get(normalized);
    if (existing) {
      return existing;
    }

    const nextId = `dataset-${idByPath.size + 1}`;
    idByPath.set(normalized, nextId);
    entries.push({ id: nextId, path: normalized });
    return nextId;
  };

  register(activeDatasetPath);

  return {
    register,
    idFor: (datasetPath: string) => register(datasetPath),
    entries: () => entries
  };
}
