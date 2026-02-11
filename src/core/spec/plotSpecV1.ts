import type { WorkspaceState } from "../../webview/state/workspaceState";

export const PLOT_SPEC_V1_VERSION = 1;

export type PlotSpecAxisV1 = {
  id: `y${number}`;
  title?: string;
  range?: [number, number];
  scale?: "linear" | "log";
};

export type PlotSpecTraceV1 = {
  id: string;
  signal: string;
  axisId: `y${number}`;
  visible: boolean;
  color?: string;
  lineWidth?: number;
};

export type PlotSpecPlotV1 = {
  id: string;
  name: string;
  xSignal: string;
  axes: PlotSpecAxisV1[];
  traces: PlotSpecTraceV1[];
  xRange?: [number, number];
};

export type PlotSpecV1 = {
  version: typeof PLOT_SPEC_V1_VERSION;
  dataset: {
    path: string;
  };
  workspace: {
    activePlotId: string;
    plots: PlotSpecPlotV1[];
  };
};

export type ExportPlotSpecInput = {
  datasetPath: string;
  workspace: WorkspaceState;
};

export type ImportPlotSpecInput = {
  yamlText: string;
  availableSignals: string[];
};

export type ImportPlotSpecResult = {
  datasetPath: string;
  workspace: WorkspaceState;
};

export class PlotSpecImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlotSpecImportError";
  }
}
