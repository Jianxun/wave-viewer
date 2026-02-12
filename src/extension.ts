import * as fs from "node:fs";
import * as path from "node:path";
import type * as VSCode from "vscode";

import { exportPlotSpecV1 } from "./core/spec/exportSpec";
import { importPlotSpecV1 } from "./core/spec/importSpec";
import { parseCsv } from "./core/csv/parseCsv";
import { selectDefaultX } from "./core/dataset/selectDefaultX";
import {
  createProtocolEnvelope,
  parseWebviewToHostMessage,
  type Dataset,
  type ProtocolEnvelope,
  type SidePanelTraceTuplePayload
} from "./core/dataset/types";
import {
  createDoubleClickQuickAddResolver,
  createSignalTreeDragAndDropController,
  createSignalTreeDataProvider,
  type SignalTreeDataProvider,
  LOAD_CSV_FILES_COMMAND,
  REMOVE_LOADED_FILE_COMMAND,
  RELOAD_ALL_FILES_COMMAND,
  SIGNAL_BROWSER_ADD_TO_NEW_AXIS_COMMAND,
  SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND,
  SIGNAL_BROWSER_QUICK_ADD_COMMAND,
  SIGNAL_BROWSER_VIEW_ID,
  REVEAL_SIGNAL_IN_PLOT_COMMAND,
  resolveDatasetPathFromCommandArgument,
  resolveSignalFromCommandArgument
} from "./extension/signalTree";
import { reduceWorkspaceState } from "./webview/state/reducer";
import { createWorkspaceState, type WorkspaceState } from "./webview/state/workspaceState";

export const OPEN_VIEWER_COMMAND = "waveViewer.openViewer";
export const EXPORT_SPEC_COMMAND = "waveViewer.exportPlotSpec";
export const IMPORT_SPEC_COMMAND = "waveViewer.importPlotSpec";
export {
  LOAD_CSV_FILES_COMMAND,
  REMOVE_LOADED_FILE_COMMAND,
  RELOAD_ALL_FILES_COMMAND,
  REVEAL_SIGNAL_IN_PLOT_COMMAND,
  SIGNAL_BROWSER_ADD_TO_NEW_AXIS_COMMAND,
  SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND,
  SIGNAL_BROWSER_QUICK_ADD_COMMAND
};

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
  | ProtocolEnvelope<"host/workspaceLoaded", { workspace: WorkspaceState }>
  | ProtocolEnvelope<"host/workspacePatched", { workspace: WorkspaceState; reason: string }>
  | ProtocolEnvelope<"host/sidePanelQuickAdd", { signal: string }>
  | ProtocolEnvelope<
      "host/sidePanelTraceInjected",
      { viewerId: string; trace: SidePanelTraceTuplePayload }
    >;

export type WebviewToHostMessage =
  | ProtocolEnvelope<"webview/ready", Record<string, unknown>>
  | ProtocolEnvelope<"webview/workspaceChanged", { workspace: WorkspaceState; reason: string }>
  | ProtocolEnvelope<
      "webview/dropSignal",
      {
        signal: string;
        plotId: string;
        target: { kind: "axis"; axisId: string } | { kind: "new-axis" };
        source: "axis-row" | "canvas-overlay";
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
  getCachedWorkspace(documentPath: string): WorkspaceState | undefined;
  setCachedWorkspace(documentPath: string, workspace: WorkspaceState): void;
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

export function createViewerSessionRegistry(): ViewerSessionRegistry {
  type ViewerSession = {
    panel: WebviewPanelLike;
    datasetPath?: string;
    focusOrder: number;
  };

  let nextViewerNumber = 1;
  let nextFocusOrder = 1;
  let activeViewerId: string | undefined;
  const viewerById = new Map<string, ViewerSession>();
  const viewerIdsByDatasetPath = new Map<string, Set<string>>();

  function removeDatasetIndex(datasetPath: string, viewerId: string): void {
    const viewerIds = viewerIdsByDatasetPath.get(datasetPath);
    if (!viewerIds) {
      return;
    }
    viewerIds.delete(viewerId);
    if (viewerIds.size === 0) {
      viewerIdsByDatasetPath.delete(datasetPath);
    }
  }

  function addDatasetIndex(datasetPath: string, viewerId: string): void {
    const viewerIds = viewerIdsByDatasetPath.get(datasetPath) ?? new Set<string>();
    viewerIds.add(viewerId);
    viewerIdsByDatasetPath.set(datasetPath, viewerIds);
  }

  function pickMostRecentlyFocusedViewerId(viewerIds: Iterable<string>): string | undefined {
    let selectedViewerId: string | undefined;
    let selectedFocusOrder = -1;
    for (const viewerId of viewerIds) {
      const session = viewerById.get(viewerId);
      if (!session) {
        continue;
      }
      if (session.focusOrder > selectedFocusOrder) {
        selectedFocusOrder = session.focusOrder;
        selectedViewerId = viewerId;
      }
    }
    return selectedViewerId;
  }

  function getSession(viewerId: string): ViewerSession | undefined {
    return viewerById.get(viewerId);
  }

  const registry: ViewerSessionRegistry = {
    registerPanel(panel: WebviewPanelLike, datasetPath?: string): string {
      const viewerId = `viewer-${nextViewerNumber++}`;
      viewerById.set(viewerId, {
        panel,
        datasetPath,
        focusOrder: nextFocusOrder++
      });
      if (datasetPath) {
        addDatasetIndex(datasetPath, viewerId);
      }
      activeViewerId = viewerId;
      panel.onDidDispose?.(() => {
        registry.removeViewer(viewerId);
      });
      panel.onDidChangeViewState?.((event) => {
        if (event.active) {
          registry.markViewerFocused(viewerId);
        }
      });
      return viewerId;
    },
    bindViewerToDataset(viewerId: string, datasetPath: string): void {
      const session = getSession(viewerId);
      if (!session) {
        return;
      }
      if (session.datasetPath === datasetPath) {
        return;
      }
      if (session.datasetPath) {
        removeDatasetIndex(session.datasetPath, viewerId);
      }
      session.datasetPath = datasetPath;
      addDatasetIndex(datasetPath, viewerId);
    },
    markViewerFocused(viewerId: string): void {
      const session = getSession(viewerId);
      if (!session) {
        return;
      }
      activeViewerId = viewerId;
      session.focusOrder = nextFocusOrder++;
    },
    removeViewer(viewerId: string): void {
      const session = getSession(viewerId);
      if (!session) {
        return;
      }
      if (session.datasetPath) {
        removeDatasetIndex(session.datasetPath, viewerId);
      }
      viewerById.delete(viewerId);

      if (activeViewerId !== viewerId) {
        return;
      }
      activeViewerId = pickMostRecentlyFocusedViewerId(viewerById.keys());
    },
    resolveTargetViewerSession(datasetPath: string): ViewerSessionRoute | undefined {
      const activeSession = activeViewerId ? getSession(activeViewerId) : undefined;
      if (activeSession && activeViewerId && activeSession.datasetPath === datasetPath) {
        return { viewerId: activeViewerId, panel: activeSession.panel, bindDataset: false };
      }

      if (activeSession && activeViewerId && !activeSession.datasetPath) {
        return { viewerId: activeViewerId, panel: activeSession.panel, bindDataset: true };
      }

      const datasetViewerIds = viewerIdsByDatasetPath.get(datasetPath);
      if (!datasetViewerIds || datasetViewerIds.size === 0) {
        return undefined;
      }

      const targetViewerId = pickMostRecentlyFocusedViewerId(datasetViewerIds);
      if (!targetViewerId) {
        return undefined;
      }
      const targetSession = getSession(targetViewerId);
      if (!targetSession) {
        return undefined;
      }
      return { viewerId: targetViewerId, panel: targetSession.panel, bindDataset: false };
    },
    hasOpenPanelForDataset(datasetPath: string): boolean {
      return (viewerIdsByDatasetPath.get(datasetPath)?.size ?? 0) > 0;
    },
    getPanelForDataset(datasetPath: string): WebviewPanelLike | undefined {
      const target = registry.resolveTargetViewerSession(datasetPath);
      return target && !target.bindDataset ? target.panel : undefined;
    },
    getActiveViewerId(): string | undefined {
      return activeViewerId;
    }
  };
  return registry;
}

export function applySidePanelSignalAction(
  workspace: WorkspaceState,
  action: SidePanelSignalAction,
  options?: { sourceId?: string }
): WorkspaceState {
  if (action.type === "add-to-plot") {
    return reduceWorkspaceState(workspace, {
      type: "trace/add",
      payload: { signal: action.signal, sourceId: options?.sourceId }
    });
  }

  if (action.type === "add-to-new-axis") {
    const withAxis = reduceWorkspaceState(workspace, { type: "axis/add" });
    const activePlot = withAxis.plots.find((plot) => plot.id === withAxis.activePlotId);
    const axisId = activePlot?.axes[activePlot.axes.length - 1]?.id;
    if (!axisId) {
      return withAxis;
    }
    return reduceWorkspaceState(withAxis, {
      type: "trace/add",
      payload: { signal: action.signal, sourceId: options?.sourceId, axisId }
    });
  }

  const revealPlot = workspace.plots.find((plot) =>
    plot.traces.some((trace) => trace.signal === action.signal)
  );
  if (!revealPlot) {
    return workspace;
  }

  let revealed = reduceWorkspaceState(workspace, {
    type: "plot/setActive",
    payload: { plotId: revealPlot.id }
  });

  for (const trace of revealPlot.traces) {
    if (trace.signal !== action.signal || trace.visible) {
      continue;
    }
    revealed = reduceWorkspaceState(revealed, {
      type: "trace/setVisible",
      payload: { traceId: trace.id, visible: true }
    });
  }

  return revealed;
}

export function applyDropSignalAction(
  workspace: WorkspaceState,
  payload: Extract<WebviewToHostMessage, { type: "webview/dropSignal" }>["payload"],
  options?: { sourceId?: string }
): WorkspaceState {
  let nextWorkspace = reduceWorkspaceState(workspace, {
    type: "plot/setActive",
    payload: { plotId: payload.plotId }
  });

  if (payload.target.kind === "new-axis") {
    nextWorkspace = reduceWorkspaceState(nextWorkspace, {
      type: "axis/add",
      payload: { plotId: payload.plotId }
    });
    const targetPlot = nextWorkspace.plots.find((plot) => plot.id === payload.plotId);
    const newAxisId = targetPlot?.axes[targetPlot.axes.length - 1]?.id;
    if (!newAxisId) {
      return nextWorkspace;
    }

    return reduceWorkspaceState(nextWorkspace, {
      type: "trace/add",
      payload: {
        plotId: payload.plotId,
        signal: payload.signal,
        sourceId: options?.sourceId,
        axisId: newAxisId
      }
    });
  }

  if (!isAxisId(payload.target.axisId)) {
    throw new Error(`Invalid dropSignal axis id: ${payload.target.axisId}`);
  }

  return reduceWorkspaceState(nextWorkspace, {
    type: "trace/add",
    payload: {
      plotId: payload.plotId,
      signal: payload.signal,
      sourceId: options?.sourceId,
      axisId: payload.target.axisId
    }
  });
}

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

export function isCsvFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".csv");
}

export function createOpenViewerCommand(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const activeDocument = deps.getActiveDocument();
    const activeDatasetPath =
      activeDocument && isCsvFile(activeDocument.fileName) ? activeDocument.uri.fsPath : undefined;
    const datasetPath = activeDatasetPath ?? deps.getPreferredDatasetPath?.();
    let normalizedDataset: { dataset: Dataset; defaultXSignal: string } | undefined;

    if (datasetPath) {
      try {
        normalizedDataset = deps.loadDataset(datasetPath);
      } catch (error) {
        deps.showError(getErrorMessage(error));
        return;
      }
      deps.onDatasetLoaded?.(datasetPath, normalizedDataset);
    }

    const panel = deps.createPanel();
    const viewerId = deps.onPanelCreated?.(datasetPath, panel) ?? "viewer-unknown";
    panel.webview.html = deps.buildHtml(panel.webview, deps.extensionUri);

    panel.webview.onDidReceiveMessage((rawMessage) => {
      const message = parseWebviewToHostMessage(rawMessage);
      if (!message) {
        deps.logDebug?.("Ignored invalid or unknown webview message.", rawMessage);
        return;
      }

      if (message.type === "webview/workspaceChanged") {
        if (datasetPath) {
          deps.setCachedWorkspace?.(datasetPath, message.payload.workspace as WorkspaceState);
        }
        return;
      }

      if (message.type === "webview/dropSignal") {
        if (!datasetPath || !normalizedDataset) {
          deps.logDebug?.("Ignored dropSignal because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }

        const cachedWorkspace =
          deps.getCachedWorkspace?.(datasetPath) ??
          createWorkspaceState(normalizedDataset.defaultXSignal);

        let nextWorkspace: WorkspaceState;
        try {
          nextWorkspace = applyDropSignalAction(cachedWorkspace, message.payload, {
            sourceId: toTraceSourceId(datasetPath, message.payload.signal)
          });
        } catch (error) {
          deps.logDebug?.("Ignored invalid webview dropSignal message payload.", {
            payload: message.payload,
            error: getErrorMessage(error)
          });
          return;
        }

        deps.setCachedWorkspace?.(datasetPath, nextWorkspace);
        for (const trace of getAddedTraces(cachedWorkspace, nextWorkspace)) {
          void panel.webview.postMessage(
            createProtocolEnvelope(
              "host/sidePanelTraceInjected",
              createSidePanelTraceInjectedPayload(
                viewerId,
                datasetPath,
                normalizedDataset,
                trace.signal,
                {
                  traceId: trace.id,
                  sourceId: trace.sourceId
                }
              )
            )
          );
        }
        void panel.webview.postMessage(
          createProtocolEnvelope("host/workspacePatched", {
            workspace: nextWorkspace,
            reason: `dropSignal:${message.payload.source}`
          })
        );
        return;
      }

      if (message.type !== "webview/ready") {
        deps.logDebug?.("Ignored unsupported webview message type.", message.type);
        return;
      }

      void panel.webview.postMessage(createProtocolEnvelope("host/init", { title: "Wave Viewer" }));
      void panel.webview.postMessage(
        createProtocolEnvelope(
          "host/viewerBindingUpdated",
          createViewerBindingUpdatedPayload(viewerId, datasetPath)
        )
      );

      if (!datasetPath || !normalizedDataset) {
        return;
      }

      void panel.webview.postMessage(
        createProtocolEnvelope(
          "host/datasetLoaded",
          createDatasetLoadedPayload(datasetPath, normalizedDataset)
        )
      );

      const cachedWorkspace = deps.getCachedWorkspace?.(datasetPath);
      if (cachedWorkspace) {
        void panel.webview.postMessage(
          createProtocolEnvelope("host/workspaceLoaded", { workspace: cachedWorkspace })
        );
      }
    });
  };
}

export function createLoadCsvFilesCommand(deps: LoadCsvFilesCommandDeps): () => Promise<void> {
  return async () => {
    const selectedPaths = await deps.showOpenDialog();
    if (!selectedPaths || selectedPaths.length === 0) {
      return;
    }

    for (const documentPath of selectedPaths) {
      try {
        const loaded = deps.loadDataset(documentPath);
        deps.registerLoadedDataset(documentPath, loaded);
      } catch (error) {
        deps.showError(`Failed to load '${documentPath}': ${getErrorMessage(error)}`);
      }
    }
  };
}

export function createReloadAllLoadedFilesCommand(
  deps: ReloadAllLoadedFilesCommandDeps
): () => Promise<void> {
  return async () => {
    for (const documentPath of deps.getLoadedDatasetPaths()) {
      try {
        const loaded = deps.loadDataset(documentPath);
        deps.registerLoadedDataset(documentPath, loaded);
      } catch (error) {
        deps.showError(`Failed to reload '${documentPath}': ${getErrorMessage(error)}`);
      }
    }
  };
}

export function createRemoveLoadedFileCommand(
  deps: RemoveLoadedFileCommandDeps
): (item?: unknown) => void {
  return (item?: unknown) => {
    const datasetPath = resolveDatasetPathFromCommandArgument(item);
    if (!datasetPath) {
      deps.showError("Select a loaded CSV file in the Wave Viewer side panel.");
      return;
    }

    const removed = deps.removeLoadedDataset(datasetPath);
    if (!removed) {
      deps.showError(`Loaded dataset '${datasetPath}' is no longer available.`);
      return;
    }

    deps.markDatasetAsRemoved(datasetPath);
    if (deps.hasOpenPanel(datasetPath)) {
      deps.showWarning(
        `Removed '${path.basename(
          datasetPath
        )}' from loaded files. Its open viewer remains available, but side-panel signal adds are blocked until this file is loaded again.`
      );
    }
  };
}

export function resolveSidePanelSelection(
  deps: ResolveSidePanelSelectionDeps
): { documentPath: string; loadedDataset: LoadedDatasetRecord; signal: string } | undefined {
  const resolved = deps.selection;
  if (!resolved) {
    deps.showError("Select a numeric signal in the Wave Viewer side panel.");
    return undefined;
  }

  const documentPath = resolved.datasetPath ?? deps.getSingleLoadedDatasetPath();
  if (!documentPath) {
    deps.showError("Select a signal under a loaded CSV file in the Wave Viewer side panel.");
    return undefined;
  }

  const loadedDataset = deps.getLoadedDataset(documentPath);
  if (!loadedDataset) {
    if (deps.wasDatasetRemoved(documentPath)) {
      deps.showWarning(
        `CSV file '${path.basename(
          documentPath
        )}' was removed from loaded files. Load it again before using side-panel signal actions.`
      );
      return undefined;
    }

    deps.showError(`Loaded dataset '${documentPath}' is no longer available.`);
    return undefined;
  }

  const signals = loadedDataset.dataset.columns.map((column) => column.name);
  if (!signals.includes(resolved.signal)) {
    deps.showError(
      `Signal '${resolved.signal}' is not available in loaded dataset '${path.basename(documentPath)}'.`
    );
    return undefined;
  }

  return { documentPath, loadedDataset, signal: resolved.signal };
}

function createDatasetLoadedPayload(documentPath: string, loaded: LoadedDatasetRecord): Extract<
  HostToWebviewMessage,
  { type: "host/datasetLoaded" }
>["payload"] {
  return {
    path: documentPath,
    fileName: path.basename(documentPath),
    rowCount: loaded.dataset.rowCount,
    columns: loaded.dataset.columns.map((column) => ({
      name: column.name,
      values: column.values
    })),
    defaultXSignal: loaded.defaultXSignal
  };
}

function createViewerBindingUpdatedPayload(
  viewerId: string,
  datasetPath?: string
): Extract<HostToWebviewMessage, { type: "host/viewerBindingUpdated" }>["payload"] {
  return {
    viewerId,
    datasetPath
  };
}

function toTraceSourceId(documentPath: string, signal: string): string {
  return `${documentPath}::${signal}`;
}

function getAddedTraces(previous: WorkspaceState, next: WorkspaceState): Array<{
  id: string;
  signal: string;
  sourceId?: string;
}> {
  const previousTraceIds = new Set<string>();
  for (const plot of previous.plots) {
    for (const trace of plot.traces) {
      previousTraceIds.add(trace.id);
    }
  }

  const addedTraces: Array<{ id: string; signal: string; sourceId?: string }> = [];
  for (const plot of next.plots) {
    for (const trace of plot.traces) {
      if (previousTraceIds.has(trace.id)) {
        continue;
      }
      addedTraces.push({
        id: trace.id,
        signal: trace.signal,
        sourceId: trace.sourceId
      });
    }
  }
  return addedTraces;
}

function createSidePanelTraceInjectedPayload(
  viewerId: string,
  documentPath: string,
  loadedDataset: LoadedDatasetRecord,
  signal: string,
  options?: { traceId?: string; sourceId?: string }
): Extract<HostToWebviewMessage, { type: "host/sidePanelTraceInjected" }>["payload"] {
  const xColumn = loadedDataset.dataset.columns.find(
    (column) => column.name === loadedDataset.defaultXSignal
  );
  const yColumn = loadedDataset.dataset.columns.find((column) => column.name === signal);
  if (!xColumn || !yColumn) {
    throw new Error(
      `Cannot build side-panel trace tuple for signal '${signal}' in '${path.basename(documentPath)}'.`
    );
  }

  return {
    viewerId,
    trace: {
      traceId: options?.traceId ?? `${viewerId}:${signal}:${yColumn.values.length}`,
      sourceId: options?.sourceId ?? toTraceSourceId(documentPath, signal),
      datasetPath: documentPath,
      xName: xColumn.name,
      yName: yColumn.name,
      x: xColumn.values,
      y: yColumn.values
    }
  };
}

function toSidePanelActionLabel(actionType: SidePanelSignalAction["type"]): string {
  if (actionType === "add-to-plot") {
    return "Add Signal to Plot";
  }
  if (actionType === "add-to-new-axis") {
    return "Add Signal to New Axis";
  }
  return "Reveal Signal in Plot";
}

export function createNoTargetViewerWarning(
  actionType: SidePanelSignalAction["type"],
  documentPath: string
): string {
  return `${toSidePanelActionLabel(
    actionType
  )} failed: no open Wave Viewer can accept '${path.basename(
    documentPath
  )}'. Open Wave Viewer for that CSV and retry.`;
}

export function runResolvedSidePanelSignalAction(
  deps: RunResolvedSidePanelSignalActionDeps
): WorkspaceState {
  const workspace =
    deps.getCachedWorkspace(deps.documentPath) ?? createWorkspaceState(deps.loadedDataset.defaultXSignal);
  const nextWorkspace = applySidePanelSignalAction(workspace, {
    type: deps.actionType,
    signal: deps.signal
  }, {
    sourceId: toTraceSourceId(deps.documentPath, deps.signal)
  });
  deps.setCachedWorkspace(deps.documentPath, nextWorkspace);

  const boundPanel = deps.getBoundPanel(deps.documentPath);
  const standalonePanel = deps.getStandalonePanel();
  const panel = boundPanel ?? standalonePanel;

  if (!panel) {
    deps.showWarning(createNoTargetViewerWarning(deps.actionType, deps.documentPath));
    return nextWorkspace;
  }

  const viewerId = deps.bindPanelToDataset(deps.documentPath, panel) ?? "viewer-unknown";

  if (!boundPanel && standalonePanel === panel) {
    deps.clearStandalonePanel(panel);
    void panel.webview.postMessage(
      createProtocolEnvelope(
        "host/datasetLoaded",
        createDatasetLoadedPayload(deps.documentPath, deps.loadedDataset)
      )
    );
    void panel.webview.postMessage(
      createProtocolEnvelope(
        "host/viewerBindingUpdated",
        createViewerBindingUpdatedPayload(viewerId, deps.documentPath)
      )
    );
  }

  for (const trace of getAddedTraces(workspace, nextWorkspace)) {
    void panel.webview.postMessage(
      createProtocolEnvelope(
        "host/sidePanelTraceInjected",
        createSidePanelTraceInjectedPayload(viewerId, deps.documentPath, deps.loadedDataset, trace.signal, {
          traceId: trace.id,
          sourceId: trace.sourceId
        })
      )
    );
  }

  void panel.webview.postMessage(
    createProtocolEnvelope("host/workspacePatched", {
      workspace: nextWorkspace,
      reason: `sidePanel:${deps.actionType}`
    })
  );

  return nextWorkspace;
}

export function runResolvedSidePanelQuickAdd(deps: RunResolvedSidePanelQuickAddDeps): boolean {
  if (deps.targetViewer.bindDataset) {
    deps.bindViewerToDataset(deps.targetViewer.viewerId, deps.documentPath);
    void deps.targetViewer.panel.webview.postMessage(
      createProtocolEnvelope(
        "host/datasetLoaded",
        createDatasetLoadedPayload(deps.documentPath, deps.loadedDataset)
      )
    );
    void deps.targetViewer.panel.webview.postMessage(
      createProtocolEnvelope(
        "host/viewerBindingUpdated",
        createViewerBindingUpdatedPayload(deps.targetViewer.viewerId, deps.documentPath)
      )
    );
  }

  let traceInjectionPayload:
    | Extract<HostToWebviewMessage, { type: "host/sidePanelTraceInjected" }>["payload"]
    | undefined;
  try {
    traceInjectionPayload = createSidePanelTraceInjectedPayload(
      deps.targetViewer.viewerId,
      deps.documentPath,
      deps.loadedDataset,
      deps.signal
    );
  } catch (error) {
    deps.showError(getErrorMessage(error));
    return false;
  }

  void deps.targetViewer.panel.webview.postMessage(
    createProtocolEnvelope("host/sidePanelTraceInjected", traceInjectionPayload)
  );
  return true;
}

export function createExportSpecCommand(deps: ExportSpecCommandDeps): () => Promise<void> {
  return async () => {
    const activeDocument = deps.getActiveDocument();
    if (!activeDocument) {
      deps.showError("Open a CSV file in the editor before exporting a Wave Viewer spec.");
      return;
    }

    if (!isCsvFile(activeDocument.fileName)) {
      deps.showError("Wave Viewer spec export requires an active .csv file.");
      return;
    }

    let normalizedDataset: { dataset: Dataset; defaultXSignal: string };
    try {
      normalizedDataset = deps.loadDataset(activeDocument.uri.fsPath);
    } catch (error) {
      deps.showError(getErrorMessage(error));
      return;
    }

    const workspace =
      deps.getCachedWorkspace(activeDocument.uri.fsPath) ??
      createWorkspaceState(normalizedDataset.defaultXSignal);

    const defaultSpecPath = `${activeDocument.uri.fsPath}.wave-viewer.yaml`;
    const savePath = await deps.showSaveDialog(defaultSpecPath);
    if (!savePath) {
      return;
    }

    const yaml = exportPlotSpecV1({
      datasetPath: activeDocument.uri.fsPath,
      workspace
    });

    deps.writeTextFile(savePath, yaml);
    deps.showInformation(`Wave Viewer spec exported to ${savePath}`);
  };
}

export function createImportSpecCommand(deps: ImportSpecCommandDeps): () => Promise<void> {
  return async () => {
    const activeDocument = deps.getActiveDocument();
    if (!activeDocument) {
      deps.showError("Open a CSV file in the editor before importing a Wave Viewer spec.");
      return;
    }

    if (!isCsvFile(activeDocument.fileName)) {
      deps.showError("Wave Viewer spec import requires an active .csv file.");
      return;
    }

    let normalizedDataset: { dataset: Dataset; defaultXSignal: string };
    try {
      normalizedDataset = deps.loadDataset(activeDocument.uri.fsPath);
    } catch (error) {
      deps.showError(getErrorMessage(error));
      return;
    }

    const specPath = await deps.showOpenDialog();
    if (!specPath) {
      return;
    }

    let parsed;
    try {
      parsed = importPlotSpecV1({
        yamlText: deps.readTextFile(specPath),
        availableSignals: normalizedDataset.dataset.columns.map((column) => column.name)
      });
    } catch (error) {
      deps.showError(getErrorMessage(error));
      return;
    }

    deps.setCachedWorkspace(activeDocument.uri.fsPath, parsed.workspace);
    deps.showInformation(`Wave Viewer spec imported from ${specPath}`);
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Failed to load CSV dataset.";
}

function isAxisId(value: string): value is `y${number}` {
  return /^y\d+$/.test(value);
}

function readWebviewTemplate(extensionUri: VSCode.Uri): string {
  const vscode = loadVscode();
  const templatePath = vscode.Uri.joinPath(extensionUri, "src", "webview", "index.html").fsPath;
  return fs.readFileSync(templatePath, "utf8");
}

export function buildWebviewHtml(webview: VSCode.Webview, extensionUri: VSCode.Uri): string {
  const vscode = loadVscode();
  const template = readWebviewTemplate(extensionUri);
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "main.js")
  );
  const stylesUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "src", "webview", "styles.css")
  );

  return template
    .replace(/__CSP_SOURCE__/g, webview.cspSource)
    .replace(/__SCRIPT_URI__/g, scriptUri.toString())
    .replace(/__STYLE_URI__/g, stylesUri.toString());
}

function loadVscode(): typeof VSCode {
  return require("vscode") as typeof VSCode;
}

export function activate(context: VSCode.ExtensionContext): void {
  const vscode = loadVscode();
  const workspaceByDatasetPath = new Map<string, WorkspaceState>();
  const viewerSessions = createViewerSessionRegistry();
  const loadedDatasetByPath = new Map<string, LoadedDatasetRecord>();
  const removedDatasetPathSet = new Set<string>();
  const signalTreeProvider = createSignalTreeDataProvider(vscode);
  const resolveQuickAddDoubleClick = createDoubleClickQuickAddResolver();

  function refreshSignalTree(): void {
    const loadedDatasets = Array.from(loadedDatasetByPath.entries()).map(([datasetPath, loaded]) => ({
      datasetPath,
      fileName: path.basename(datasetPath),
      signals: loaded.dataset.columns.map((column) => column.name)
    }));
    signalTreeProvider.setLoadedDatasets(loadedDatasets);
  }

  function registerLoadedDataset(
    documentPath: string,
    loaded: LoadedDatasetRecord
  ): void {
    loadedDatasetByPath.set(documentPath, loaded);
    removedDatasetPathSet.delete(documentPath);
    refreshSignalTree();
  }

  function getSingleLoadedDatasetPath(): string | undefined {
    if (loadedDatasetByPath.size === 1) {
      return loadedDatasetByPath.keys().next().value as string | undefined;
    }
    return undefined;
  }

  function getMostRecentlyLoadedDatasetPath(): string | undefined {
    let latest: string | undefined;
    for (const datasetPath of loadedDatasetByPath.keys()) {
      latest = datasetPath;
    }
    return latest;
  }

  function removeLoadedDataset(documentPath: string): boolean {
    const existed = loadedDatasetByPath.delete(documentPath);
    if (existed) {
      refreshSignalTree();
    }
    return existed;
  }

  function runSidePanelSignalAction(actionType: SidePanelSignalAction["type"]): (item?: unknown) => void {
    return (item?: unknown) => {
      const selection = resolveSidePanelSelection({
        selection: resolveSignalFromCommandArgument(item),
        getLoadedDataset: (documentPath) => loadedDatasetByPath.get(documentPath),
        getSingleLoadedDatasetPath,
        wasDatasetRemoved: (documentPath) => removedDatasetPathSet.has(documentPath),
        showError: (message) => {
          void vscode.window.showErrorMessage(message);
        },
        showWarning: (message) => {
          void vscode.window.showWarningMessage(message);
        }
      });
      if (!selection) {
        return;
      }

      runResolvedSidePanelSignalAction({
        actionType,
        documentPath: selection.documentPath,
        loadedDataset: selection.loadedDataset,
        signal: selection.signal,
        getCachedWorkspace: (documentPath) => workspaceByDatasetPath.get(documentPath),
        setCachedWorkspace: (documentPath, workspace) => {
          workspaceByDatasetPath.set(documentPath, workspace);
        },
        getBoundPanel: () => {
          const target = viewerSessions.resolveTargetViewerSession(selection.documentPath);
          return target && !target.bindDataset ? target.panel : undefined;
        },
        getStandalonePanel: () => {
          const target = viewerSessions.resolveTargetViewerSession(selection.documentPath);
          return target?.bindDataset ? target.panel : undefined;
        },
        bindPanelToDataset: (documentPath, panel) => {
          const target = viewerSessions.resolveTargetViewerSession(documentPath);
          if (target && target.panel === panel) {
            viewerSessions.bindViewerToDataset(target.viewerId, documentPath);
            return target.viewerId;
          }
          return undefined;
        },
        clearStandalonePanel: () => undefined,
        showWarning: (message) => {
          void vscode.window.showWarningMessage(message);
        }
      });
    };
  }

  const runSidePanelQuickAdd = (item?: unknown): void => {
    const resolved = resolveSignalFromCommandArgument(item);
    const selection = resolveSidePanelSelection({
      selection: resolved,
      getLoadedDataset: (documentPath) => loadedDatasetByPath.get(documentPath),
      getSingleLoadedDatasetPath,
      wasDatasetRemoved: (documentPath) => removedDatasetPathSet.has(documentPath),
      showError: (message) => {
        void vscode.window.showErrorMessage(message);
      },
      showWarning: (message) => {
        void vscode.window.showWarningMessage(message);
      }
    });
    if (!selection) {
      return;
    }

    if (!resolveQuickAddDoubleClick({ signal: selection.signal, datasetPath: selection.documentPath })) {
      return;
    }

    const targetViewer = viewerSessions.resolveTargetViewerSession(selection.documentPath);
    if (!targetViewer) {
      const workspace =
        workspaceByDatasetPath.get(selection.documentPath) ??
        createWorkspaceState(selection.loadedDataset.defaultXSignal);
      const nextWorkspace = applySidePanelSignalAction(workspace, {
        type: "add-to-plot",
        signal: selection.signal
      });
      workspaceByDatasetPath.set(selection.documentPath, nextWorkspace);
      return;
    }

    runResolvedSidePanelQuickAdd({
      documentPath: selection.documentPath,
      loadedDataset: selection.loadedDataset,
      signal: selection.signal,
      targetViewer,
      bindViewerToDataset: (viewerId, datasetPath) => {
        viewerSessions.bindViewerToDataset(viewerId, datasetPath);
      },
      showError: (message) => {
        void vscode.window.showErrorMessage(message);
      }
    });
  };

  const command = createOpenViewerCommand({
    extensionUri: context.extensionUri,
    getActiveDocument: () => vscode.window.activeTextEditor?.document,
    getPreferredDatasetPath: getMostRecentlyLoadedDatasetPath,
    loadDataset: (documentPath) => {
      const csvText = fs.readFileSync(documentPath, "utf8");
      const dataset = parseCsv({ path: documentPath, csvText });
      const defaultXSignal = selectDefaultX(dataset);
      return { dataset, defaultXSignal };
    },
    onDatasetLoaded: (documentPath, loaded) => {
      registerLoadedDataset(documentPath, loaded);
    },
    getCachedWorkspace: (documentPath) => workspaceByDatasetPath.get(documentPath),
    setCachedWorkspace: (documentPath, workspace) => {
      workspaceByDatasetPath.set(documentPath, workspace);
    },
    createPanel: () =>
      vscode.window.createWebviewPanel("waveViewer.main", "Wave Viewer", vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true
      }) as unknown as WebviewPanelLike,
    onPanelCreated: (documentPath, panel) => viewerSessions.registerPanel(panel, documentPath),
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    logDebug: (message, details) => {
      console.debug(`[wave-viewer] ${message}`, details);
    },
    buildHtml: (webview, extensionUriArg) =>
      buildWebviewHtml(webview as unknown as VSCode.Webview, extensionUriArg as VSCode.Uri)
  });

  const exportSpecCommand = createExportSpecCommand({
    getActiveDocument: () => vscode.window.activeTextEditor?.document,
    loadDataset: (documentPath) => {
      const csvText = fs.readFileSync(documentPath, "utf8");
      const dataset = parseCsv({ path: documentPath, csvText });
      const defaultXSignal = selectDefaultX(dataset);
      return { dataset, defaultXSignal };
    },
    getCachedWorkspace: (documentPath) => workspaceByDatasetPath.get(documentPath),
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    showInformation: (message) => {
      void vscode.window.showInformationMessage(message);
    },
    showSaveDialog: async (defaultPath) => {
      const defaultUri = vscode.Uri.file(defaultPath);
      const result = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { YAML: ["yaml", "yml"] }
      });
      return result?.fsPath;
    },
    writeTextFile: (filePath, text) => {
      fs.writeFileSync(filePath, text, "utf8");
    }
  });

  const importSpecCommand = createImportSpecCommand({
    getActiveDocument: () => vscode.window.activeTextEditor?.document,
    loadDataset: (documentPath) => {
      const csvText = fs.readFileSync(documentPath, "utf8");
      const dataset = parseCsv({ path: documentPath, csvText });
      const defaultXSignal = selectDefaultX(dataset);
      return { dataset, defaultXSignal };
    },
    setCachedWorkspace: (documentPath, workspace) => {
      workspaceByDatasetPath.set(documentPath, workspace);
    },
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    showInformation: (message) => {
      void vscode.window.showInformationMessage(message);
    },
    showOpenDialog: async () => {
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { YAML: ["yaml", "yml"] }
      });
      return result?.[0]?.fsPath;
    },
    readTextFile: (filePath) => fs.readFileSync(filePath, "utf8")
  });

  const loadCsvFilesCommand = createLoadCsvFilesCommand({
    showOpenDialog: async () => {
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: true,
        filters: { CSV: ["csv"] }
      });
      return result?.map((uri) => uri.fsPath);
    },
    loadDataset: (documentPath) => {
      const csvText = fs.readFileSync(documentPath, "utf8");
      const dataset = parseCsv({ path: documentPath, csvText });
      const defaultXSignal = selectDefaultX(dataset);
      return { dataset, defaultXSignal };
    },
    registerLoadedDataset,
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    }
  });

  const reloadAllLoadedFilesCommand = createReloadAllLoadedFilesCommand({
    getLoadedDatasetPaths: () => Array.from(loadedDatasetByPath.keys()),
    loadDataset: (documentPath) => {
      const csvText = fs.readFileSync(documentPath, "utf8");
      const dataset = parseCsv({ path: documentPath, csvText });
      const defaultXSignal = selectDefaultX(dataset);
      return { dataset, defaultXSignal };
    },
    registerLoadedDataset,
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    }
  });

  const removeLoadedFileCommand = createRemoveLoadedFileCommand({
    removeLoadedDataset,
    hasOpenPanel: (documentPath) => viewerSessions.hasOpenPanelForDataset(documentPath),
    markDatasetAsRemoved: (documentPath) => {
      removedDatasetPathSet.add(documentPath);
    },
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    showWarning: (message) => {
      void vscode.window.showWarningMessage(message);
    }
  });

  const signalTreeView = vscode.window.createTreeView(SIGNAL_BROWSER_VIEW_ID, {
    treeDataProvider: signalTreeProvider,
    dragAndDropController: createSignalTreeDragAndDropController(vscode)
  });
  context.subscriptions.push(signalTreeView);
  context.subscriptions.push(vscode.commands.registerCommand(OPEN_VIEWER_COMMAND, command));
  context.subscriptions.push(vscode.commands.registerCommand(EXPORT_SPEC_COMMAND, exportSpecCommand));
  context.subscriptions.push(vscode.commands.registerCommand(IMPORT_SPEC_COMMAND, importSpecCommand));
  context.subscriptions.push(
    vscode.commands.registerCommand(SIGNAL_BROWSER_QUICK_ADD_COMMAND, runSidePanelQuickAdd)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND,
      runSidePanelSignalAction("add-to-plot")
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      SIGNAL_BROWSER_ADD_TO_NEW_AXIS_COMMAND,
      runSidePanelSignalAction("add-to-new-axis")
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      REVEAL_SIGNAL_IN_PLOT_COMMAND,
      runSidePanelSignalAction("reveal-in-plot")
    )
  );
  context.subscriptions.push(vscode.commands.registerCommand(LOAD_CSV_FILES_COMMAND, loadCsvFilesCommand));
  context.subscriptions.push(
    vscode.commands.registerCommand(RELOAD_ALL_FILES_COMMAND, reloadAllLoadedFilesCommand)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(REMOVE_LOADED_FILE_COMMAND, removeLoadedFileCommand)
  );
}

export function deactivate(): void {
  // No-op for MVP scaffold.
}
