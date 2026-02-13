import type { WorkspaceState } from "../../webview/state/workspaceState";

export const PLOT_SPEC_V2_VERSION = 2;

export type PlotSpecSignalRefV2 = {
  dataset: string;
  signal: string;
};

export type PlotSpecLaneV2 = {
  id: string;
  label?: string;
  range?: [number, number];
  scale?: "linear" | "log";
  signals: Record<string, PlotSpecSignalRefV2>;
};

export type PlotSpecXConfigV2 = PlotSpecSignalRefV2 & {
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
  datasets: Array<{
    id: string;
    path: string;
  }>;
  active_dataset: string;
  active_plot: string;
  plots: PlotSpecPlotV2[];
};

export type ExportPlotSpecInput = {
  datasetPath: string;
  workspace: WorkspaceState;
  specPath?: string;
  laneIdByAxisIdByPlotId?: Record<string, Record<`y${number}`, string>>;
  xDatasetPathByPlotId?: Record<string, string>;
};

export type ImportPlotSpecInput = {
  yamlText: string;
  availableSignals: string[] | Record<string, string[]>;
  specPath?: string;
};

export type ImportPlotSpecResult = {
  datasetPath: string;
  workspace: WorkspaceState;
  laneIdByAxisIdByPlotId: Record<string, Record<`y${number}`, string>>;
  xDatasetPathByPlotId: Record<string, string>;
};

export class PlotSpecImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlotSpecImportError";
  }
}
