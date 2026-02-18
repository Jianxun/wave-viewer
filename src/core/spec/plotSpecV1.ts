import type { WorkspaceState } from "../../webview/state/workspaceState";
import type { ComplexSignalAccessor } from "../dataset/types";

export const PLOT_SPEC_V3_VERSION = 3;

export type PlotSpecSignalNameV3 = {
  base: string;
  accessor?: ComplexSignalAccessor;
};

export type PlotSpecSignalRefV3 = {
  dataset: string;
  signal: PlotSpecSignalNameV3;
};

export type PlotSpecLaneV3 = {
  id: string;
  label?: string;
  range?: [number, number];
  scale?: "linear" | "log";
  signals: Record<string, PlotSpecSignalRefV3>;
};

export type PlotSpecXConfigV3 = {
  dataset: string;
  signal: PlotSpecSignalNameV3 & { accessor?: never };
  label?: string;
  range?: [number, number];
};

export type PlotSpecPlotV3 = {
  id: string;
  name: string;
  x: PlotSpecXConfigV3;
  y: PlotSpecLaneV3[];
};

export type PlotSpecV3 = {
  version: typeof PLOT_SPEC_V3_VERSION;
  datasets: Array<{
    id: string;
    path: string;
  }>;
  active_dataset: string;
  active_plot: string;
  plots: PlotSpecPlotV3[];
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
