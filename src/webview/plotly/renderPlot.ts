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
  relayout(root: HTMLElement, layout: Record<string, unknown>): Promise<unknown>;
};

type PlotlyEventDiv = HTMLElement & {
  on?(event: "plotly_relayout", handler: (eventData: Record<string, unknown>) => void): void;
  _fullLayout?: Record<string, unknown>;
};

type AxisRange = [number, number];
type PanDirection = "left" | "right" | "up" | "down";

export function createPlotRenderer(payload: {
  container: HTMLElement;
  onRelayout: (eventData: Record<string, unknown>) => void;
  plotly?: PlotlyLike;
}): {
  render: (
    plot: PlotState,
    traceTuplesBySourceId: ReadonlyMap<string, SidePanelTraceTuplePayload>
  ) => Promise<void>;
  resetAxes: (yAxisLayoutKeys: string[]) => Promise<void>;
  pan: (payload: { direction: PanDirection; yAxisLayoutKey: string; fraction?: number }) => Promise<boolean>;
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

  async function resetAxes(yAxisLayoutKeys: string[]): Promise<void> {
    const update: Record<string, unknown> = { "xaxis.autorange": true };
    for (const layoutKey of yAxisLayoutKeys) {
      update[`${layoutKey}.autorange`] = true;
    }
    await plotly.relayout(payload.container, update);
  }

  async function pan(payloadArg: {
    direction: PanDirection;
    yAxisLayoutKey: string;
    fraction?: number;
  }): Promise<boolean> {
    const targetLayoutKey =
      payloadArg.direction === "left" || payloadArg.direction === "right"
        ? "xaxis"
        : payloadArg.yAxisLayoutKey;
    const currentRange = getAxisRange(eventDiv, targetLayoutKey);
    if (!currentRange) {
      return false;
    }

    const [start, end] = currentRange;
    const span = end - start;
    if (!Number.isFinite(span) || span === 0) {
      return false;
    }

    const directionSign =
      payloadArg.direction === "left" || payloadArg.direction === "down" ? -1 : 1;
    const delta = span * (payloadArg.fraction ?? 0.1) * directionSign;
    await plotly.relayout(payload.container, {
      [`${targetLayoutKey}.range[0]`]: start + delta,
      [`${targetLayoutKey}.range[1]`]: end + delta
    });
    return true;
  }

  return { render, resetAxes, pan };
}

function getAxisRange(eventDiv: PlotlyEventDiv, axisLayoutKey: string): AxisRange | undefined {
  const axisEntry = eventDiv._fullLayout?.[axisLayoutKey];
  if (!axisEntry || typeof axisEntry !== "object") {
    return undefined;
  }
  const rangeValue = (axisEntry as { range?: unknown }).range;
  if (!Array.isArray(rangeValue) || rangeValue.length < 2) {
    return undefined;
  }

  const start = toFiniteNumber(rangeValue[0]);
  const end = toFiniteNumber(rangeValue[1]);
  if (start === undefined || end === undefined) {
    return undefined;
  }

  return [start, end];
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}
