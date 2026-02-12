import Plotly from "plotly.js-dist-min";

import {
  buildPlotlyFigure,
  type PlotlyLayout,
  type PlotlyTrace
} from "./adapter";
import type { PlotState } from "../state/workspaceState";
import type { SidePanelTraceTuplePayload } from "../../core/dataset/types";

type PlotlyLike = {
  react(
    root: HTMLElement,
    data: PlotlyTrace[],
    layout: PlotlyLayout,
    config: Record<string, unknown>
  ): Promise<unknown>;
};

type PlotlyEventDiv = HTMLElement & {
  on?(event: "plotly_relayout", handler: (eventData: Record<string, unknown>) => void): void;
};

export function createPlotRenderer(payload: {
  container: HTMLElement;
  onRelayout: (eventData: Record<string, unknown>) => void;
  plotly?: PlotlyLike;
}): {
  render: (
    plot: PlotState,
    traceTuplesBySourceId: ReadonlyMap<string, SidePanelTraceTuplePayload>
  ) => Promise<void>;
} {
  const plotly = payload.plotly ?? (Plotly as unknown as PlotlyLike);
  const eventDiv = payload.container as PlotlyEventDiv;
  let relayoutBound = false;

  function toPngFileName(plotName: string): string {
    const sanitized = plotName
      .trim()
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return sanitized.length > 0 ? sanitized : "wave-viewer-plot";
  }

  async function render(
    plot: PlotState,
    traceTuplesBySourceId: ReadonlyMap<string, SidePanelTraceTuplePayload>
  ): Promise<void> {
    const figure = buildPlotlyFigure({ plot, traceTuplesBySourceId });

    await plotly.react(payload.container, figure.data, figure.layout, {
      staticPlot: false,
      editable: false,
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      scrollZoom: true,
      modeBarButtonsToRemove: ["select2d", "lasso2d"],
      toImageButtonOptions: {
        format: "png",
        filename: toPngFileName(plot.name)
      }
    });

    if (!relayoutBound && typeof eventDiv.on === "function") {
      eventDiv.on("plotly_relayout", payload.onRelayout);
      relayoutBound = true;
    }
  }

  return { render };
}
