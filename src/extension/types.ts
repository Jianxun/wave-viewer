import type * as VSCode from "vscode";

import type {
  Dataset,
  ProtocolEnvelope,
  SidePanelTraceTuplePayload
} from "../core/dataset/types";
import type {
  HostStateSnapshot,
  HostStateTransaction,
  HostStateTransactionResult
} from "./hostStateStore";
import type { resolveSignalFromCommandArgument } from "./signalTree";
import type { WorkspaceState } from "../webview/state/workspaceState";

export type SidePanelSignalAction =
  | { type: "add-to-plot"; signal: string }
  | { type: "add-to-new-axis"; signal: string }
  | { type: "reveal-in-plot"; signal: string };

export type HostToWebviewMessage =
  | ProtocolEnvelope<"host/init", { title: string }>
  | ProtocolEnvelope<"host/viewerBindingUpdated", { viewerId: string; datasetPath?: string }>
  | ProtocolEnvelope<
      "host/datasetLoaded",
      {
        path: string;
        fileName: string;
        rowCount: number;
        columns: Array<{ name: string; values: number[] }>;
        defaultXSignal: string;
      }
    >
  | ProtocolEnvelope<
      "host/stateSnapshot",
      {
        revision: number;
        workspace: WorkspaceState;
        viewerState: {
          activePlotId: string;
          activeAxisByPlotId: Record<string, `y${number}`>;
        };
      }
    >
  | ProtocolEnvelope<
      "host/statePatch",
      {
        revision: number;
        workspace: WorkspaceState;
        viewerState: {
          activePlotId: string;
          activeAxisByPlotId: Record<string, `y${number}`>;
        };
        reason: string;
      }
    >
  | ProtocolEnvelope<"host/tupleUpsert", { tuples: SidePanelTraceTuplePayload[] }>
  | ProtocolEnvelope<"host/sidePanelQuickAdd", { signal: string }>
  | ProtocolEnvelope<
      "host/sidePanelTraceInjected",
      { viewerId: string; trace: SidePanelTraceTuplePayload }
    >;

export type WebviewToHostMessage =
  | ProtocolEnvelope<"webview/ready", Record<string, unknown>>
  | ProtocolEnvelope<
      "webview/intent/setActiveAxis",
      {
        viewerId: string;
        plotId: string;
        axisId: string;
        requestId: string;
      }
    >
  | ProtocolEnvelope<
      "webview/intent/dropSignal",
      {
        viewerId: string;
        signal: string;
        plotId: string;
        target:
          | { kind: "axis"; axisId: string }
          | { kind: "new-axis"; afterAxisId?: `y${number}` };
        source: "axis-row" | "canvas-overlay";
        requestId: string;
      }
    >;

export type ActiveDocumentLike = {
  fileName: string;
  uri: { fsPath: string };
};

export type WebviewLike = {
  html: string;
  cspSource: string;
  asWebviewUri(uri: unknown): string;
  postMessage(message: HostToWebviewMessage): Promise<boolean>;
  onDidReceiveMessage(handler: (message: unknown) => void): void;
};

export type WebviewPanelLike = {
  webview: WebviewLike;
  onDidDispose?(listener: () => void): void;
  onDidChangeViewState?(
    listener: (event: { webviewPanel: WebviewPanelLike; active: boolean; visible: boolean }) => void
  ): void;
};

export type ViewerSessionRoute = {
  viewerId: string;
  panel: WebviewPanelLike;
  bindDataset: boolean;
};

export type ViewerSessionRegistry = {
  registerPanel(panel: WebviewPanelLike, datasetPath?: string): string;
  bindViewerToDataset(viewerId: string, datasetPath: string): void;
  markViewerFocused(viewerId: string): void;
  removeViewer(viewerId: string): void;
  resolveTargetViewerSession(datasetPath: string): ViewerSessionRoute | undefined;
  hasOpenPanelForDataset(datasetPath: string): boolean;
  getPanelForDataset(datasetPath: string): WebviewPanelLike | undefined;
  getActiveViewerId(): string | undefined;
};

export type CommandDeps = {
  extensionUri: unknown;
  getActiveDocument(): ActiveDocumentLike | undefined;
  getPreferredDatasetPath?(): string | undefined;
  loadDataset(documentPath: string): { dataset: Dataset; defaultXSignal: string };
  onDatasetLoaded?(documentPath: string, loaded: { dataset: Dataset; defaultXSignal: string }): void;
  getCachedWorkspace?(documentPath: string): WorkspaceState | undefined;
  setCachedWorkspace?(documentPath: string, workspace: WorkspaceState): void;
  getHostStateSnapshot?(documentPath: string): HostStateSnapshot | undefined;
  ensureHostStateSnapshot?(documentPath: string, defaultXSignal: string): HostStateSnapshot;
  commitHostStateTransaction(transaction: HostStateTransaction): HostStateTransactionResult;
  createPanel(): WebviewPanelLike;
  onPanelCreated?(documentPath: string | undefined, panel: WebviewPanelLike): string | undefined;
  showError(message: string): void;
  logDebug?(message: string, details?: unknown): void;
  buildHtml(webview: WebviewLike, extensionUri: unknown): string;
};

export type LoadCsvFilesCommandDeps = {
  showOpenDialog(): Promise<string[] | undefined>;
  loadDataset(documentPath: string): { dataset: Dataset; defaultXSignal: string };
  registerLoadedDataset(
    documentPath: string,
    loaded: { dataset: Dataset; defaultXSignal: string }
  ): void;
  showError(message: string): void;
};

export type LoadedDatasetRecord = { dataset: Dataset; defaultXSignal: string };

export type ReloadAllLoadedFilesCommandDeps = {
  getLoadedDatasetPaths(): readonly string[];
  loadDataset(documentPath: string): { dataset: Dataset; defaultXSignal: string };
  registerLoadedDataset(
    documentPath: string,
    loaded: { dataset: Dataset; defaultXSignal: string }
  ): void;
  showError(message: string): void;
};

export type RemoveLoadedFileCommandDeps = {
  removeLoadedDataset(documentPath: string): boolean;
  hasOpenPanel(documentPath: string): boolean;
  markDatasetAsRemoved(documentPath: string): void;
  showError(message: string): void;
  showWarning(message: string): void;
};

export type ResolveSidePanelSelectionDeps = {
  selection: ReturnType<typeof resolveSignalFromCommandArgument>;
  getLoadedDataset(documentPath: string): LoadedDatasetRecord | undefined;
  getSingleLoadedDatasetPath(): string | undefined;
  wasDatasetRemoved(documentPath: string): boolean;
  showError(message: string): void;
  showWarning(message: string): void;
};

export type RunResolvedSidePanelSignalActionDeps = {
  actionType: SidePanelSignalAction["type"];
  documentPath: string;
  loadedDataset: LoadedDatasetRecord;
  signal: string;
  commitHostStateTransaction(transaction: HostStateTransaction): HostStateTransactionResult;
  getBoundPanel(documentPath: string): WebviewPanelLike | undefined;
  getStandalonePanel(): WebviewPanelLike | undefined;
  bindPanelToDataset(documentPath: string, panel: WebviewPanelLike): string | undefined;
  clearStandalonePanel(panel: WebviewPanelLike): void;
  showWarning(message: string): void;
};

export type RunResolvedSidePanelQuickAddDeps = {
  documentPath: string;
  loadedDataset: LoadedDatasetRecord;
  signal: string;
  targetViewer: ViewerSessionRoute;
  bindViewerToDataset(viewerId: string, datasetPath: string): void;
  showError(message: string): void;
};

export type ExportSpecCommandDeps = {
  getActiveDocument(): ActiveDocumentLike | undefined;
  loadDataset(documentPath: string): { dataset: Dataset; defaultXSignal: string };
  getCachedWorkspace(documentPath: string): WorkspaceState | undefined;
  showError(message: string): void;
  showInformation(message: string): void;
  showSaveDialog(defaultPath: string): Promise<string | undefined>;
  writeTextFile(filePath: string, text: string): void;
};

export type ImportSpecCommandDeps = {
  getActiveDocument(): ActiveDocumentLike | undefined;
  loadDataset(documentPath: string): { dataset: Dataset; defaultXSignal: string };
  setCachedWorkspace(documentPath: string, workspace: WorkspaceState): void;
  showError(message: string): void;
  showInformation(message: string): void;
  showOpenDialog(): Promise<string | undefined>;
  readTextFile(filePath: string): string;
};

export type ExtensionContextLike = Pick<VSCode.ExtensionContext, "extensionUri" | "subscriptions">;
