import { stringify } from "yaml";

import type {
  ExportPlotSpecInput,
  PlotSpecAxisV1,
  PlotSpecPlotV1,
  PlotSpecTraceV1,
  PlotSpecV1
} from "./plotSpecV1";
import { PLOT_SPEC_V1_VERSION } from "./plotSpecV1";

export function exportPlotSpecV1(input: ExportPlotSpecInput): string {
  const spec: PlotSpecV1 = {
    version: PLOT_SPEC_V1_VERSION,
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

            if (axis.side !== undefined) {
              specAxis.side = axis.side;
            }
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

  return stringify(spec, {
    indent: 2,
    lineWidth: 0
  });
}
