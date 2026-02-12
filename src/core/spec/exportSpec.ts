import * as path from "node:path";
import { stringify } from "yaml";

import type {
  ExportPlotSpecInput,
  PlotSpecAxisV1,
  PlotSpecPlotV1,
  PlotSpecTraceV1,
  PlotSpecV1
} from "./plotSpecV1";
import { PLOT_SPEC_V1_VERSION, REFERENCE_ONLY_SPEC_MODE } from "./plotSpecV1";

export function exportPlotSpecV1(input: ExportPlotSpecInput): string {
  const spec: PlotSpecV1 = {
    version: PLOT_SPEC_V1_VERSION,
    mode: REFERENCE_ONLY_SPEC_MODE,
    dataset: {
      path: serializeDatasetPath(input.datasetPath, input.specPath)
    },
    workspace: {
      activePlotId: input.workspace.activePlotId,
      plots: input.workspace.plots.map((plot) => {
        const specPlot: PlotSpecPlotV1 = {
          id: plot.id,
          name: plot.name,
          xSignal: plot.xSignal,
          axes: plot.axes.map((axis) => {
            const specAxis: PlotSpecAxisV1 = {
              id: axis.id
            };

            if (axis.title !== undefined) {
              specAxis.title = axis.title;
            }
            if (axis.range !== undefined) {
              specAxis.range = axis.range;
            }
            if (axis.scale !== undefined) {
              specAxis.scale = axis.scale;
            }

            return specAxis;
          }),
          traces: plot.traces.map((trace) => {
            const specTrace: PlotSpecTraceV1 = {
              id: trace.id,
              signal: trace.signal,
              axisId: trace.axisId,
              visible: trace.visible
            };

            if (trace.color !== undefined) {
              specTrace.color = trace.color;
            }
            if (trace.lineWidth !== undefined) {
              specTrace.lineWidth = trace.lineWidth;
            }

            return specTrace;
          })
        };

        if (plot.xRange !== undefined) {
          specPlot.xRange = plot.xRange;
        }

        return specPlot;
      })
    }
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
