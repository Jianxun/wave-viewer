import { stringify } from "yaml";

import type {
  ExportPlotSpecInput,
  PlotSpecAxisV1,
  PlotSpecPlotV1,
  PlotSpecTraceV1,
  PlotSpecTraceTupleV1,
  PlotSpecV1
} from "./plotSpecV1";
import {
  PLOT_SPEC_V1_VERSION,
  PORTABLE_ARCHIVE_SPEC_MODE,
  REFERENCE_ONLY_SPEC_MODE
} from "./plotSpecV1";

export function exportPlotSpecV1(input: ExportPlotSpecInput): string {
  const mode = input.mode ?? REFERENCE_ONLY_SPEC_MODE;
  const traceTupleBySourceId = input.traceTupleBySourceId ?? new Map<string, PlotSpecTraceTupleV1>();
  const archiveTraceSourceIds: string[] = [];
  const archiveTraceSourceIdSet = new Set<string>();

  const spec: PlotSpecV1 = {
    version: PLOT_SPEC_V1_VERSION,
    mode,
    dataset: {
      path: input.datasetPath
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
            const sourceId = trace.sourceId ?? `${input.datasetPath}::${trace.signal}`;
            const specTrace: PlotSpecTraceV1 = {
              id: trace.id,
              signal: trace.signal,
              axisId: trace.axisId,
              visible: trace.visible
            };

            if (trace.sourceId !== undefined || mode === PORTABLE_ARCHIVE_SPEC_MODE) {
              specTrace.sourceId = sourceId;
            }
            if (trace.color !== undefined) {
              specTrace.color = trace.color;
            }
            if (trace.lineWidth !== undefined) {
              specTrace.lineWidth = trace.lineWidth;
            }
            if (mode === PORTABLE_ARCHIVE_SPEC_MODE && !archiveTraceSourceIdSet.has(sourceId)) {
              archiveTraceSourceIdSet.add(sourceId);
              archiveTraceSourceIds.push(sourceId);
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

  if (mode === PORTABLE_ARCHIVE_SPEC_MODE) {
    spec.archive = {
      traces: archiveTraceSourceIds.map((sourceId) => {
        const tuple = traceTupleBySourceId.get(sourceId);
        if (!tuple) {
          throw new Error(
            `Portable archive export is missing tuple payload for sourceId '${sourceId}'.`
          );
        }
        return {
          sourceId,
          datasetPath: tuple.datasetPath,
          xName: tuple.xName,
          yName: tuple.yName,
          x: tuple.x,
          y: tuple.y
        };
      })
    };
  }

  return stringify(spec, {
    indent: 2,
    lineWidth: 0
  });
}
