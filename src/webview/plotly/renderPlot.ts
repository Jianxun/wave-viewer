import Plotly from "plotly.js-dist-min";

import {
  buildPlotlyFigure,
  type DatasetColumnData,
  type PlotlyLayout,
  type PlotlyTrace
} from "./adapter";
import type { PlotState } from "../state/workspaceState";

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
  render: (plot: PlotState, columns: DatasetColumnData[]) => Promise<void>;
} {
  const plotly = payload.plotly ?? (Plotly as unknown as PlotlyLike);
  const eventDiv = payload.container as PlotlyEventDiv;
  let relayoutBound = false;

  async function render(plot: PlotState, columns: DatasetColumnData[]): Promise<void> {
    const figure = buildPlotlyFigure({ plot, columns });

    await plotly.react(payload.container, figure.data, figure.layout, {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["select2d", "lasso2d"]
    });

    if (!relayoutBound && typeof eventDiv.on === "function") {
      eventDiv.on("plotly_relayout", payload.onRelayout);
      relayoutBound = true;
    }
  }

  return { render };
}
