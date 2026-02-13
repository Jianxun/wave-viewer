import * as path from "node:path";
import { stringify } from "yaml";

import type { ExportPlotSpecInput, PlotSpecLaneV2, PlotSpecPlotV2, PlotSpecV2 } from "./plotSpecV1";
import { PLOT_SPEC_V2_VERSION } from "./plotSpecV1";

export function exportPlotSpecV1(input: ExportPlotSpecInput): string {
  const spec: PlotSpecV2 = {
    version: PLOT_SPEC_V2_VERSION,
    dataset: {
      path: serializeDatasetPath(input.datasetPath, input.specPath)
    },
    active_plot: input.workspace.activePlotId,
    plots: input.workspace.plots.map((plot) => {
      const lanesByAxisId = new Map<string, PlotSpecLaneV2>();

      for (const axis of plot.axes) {
        const lane: PlotSpecLaneV2 = {
          id: axis.id,
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
        lane.signals[traceLabel] = trace.signal;
      }

      const specPlot: PlotSpecPlotV2 = {
        id: plot.id,
        name: plot.name,
        x: {
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
