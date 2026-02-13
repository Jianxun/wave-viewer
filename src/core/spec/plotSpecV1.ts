import type { WorkspaceState } from "../../webview/state/workspaceState";

export const PLOT_SPEC_V2_VERSION = 2;

export type PlotSpecLaneV2 = {
  id: string;
  label?: string;
  range?: [number, number];
  scale?: "linear" | "log";
  signals: Record<string, string>;
};

export type PlotSpecXConfigV2 = {
  signal: string;
  label?: string;
  range?: [number, number];
};

export type PlotSpecPlotV2 = {
  id: string;
  name: string;
  x: PlotSpecXConfigV2;
  y: PlotSpecLaneV2[];
};

export type PlotSpecV2 = {
  version: typeof PLOT_SPEC_V2_VERSION;
  dataset: {
    path: string;
  };
  active_plot: string;
  plots: PlotSpecPlotV2[];
};

export type ExportPlotSpecInput = {
  datasetPath: string;
  workspace: WorkspaceState;
  specPath?: string;
  laneIdByAxisIdByPlotId?: Record<string, Record<`y${number}`, string>>;
};

export type ImportPlotSpecInput = {
  yamlText: string;
  availableSignals: string[];
  specPath?: string;
};

export type ImportPlotSpecResult = {
  datasetPath: string;
  workspace: WorkspaceState;
  laneIdByAxisIdByPlotId: Record<string, Record<`y${number}`, string>>;
};

export class PlotSpecImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlotSpecImportError";
  }
}
