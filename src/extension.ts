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
  type ProtocolEnvelope
} from "./core/dataset/types";
import {
  createDoubleClickQuickAddResolver,
  createSignalTreeDragAndDropController,
  createSignalTreeDataProvider,
  type SignalTreeDataProvider,
  SIGNAL_BROWSER_ADD_TO_NEW_AXIS_COMMAND,
  SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND,
  SIGNAL_BROWSER_QUICK_ADD_COMMAND,
  SIGNAL_BROWSER_VIEW_ID,
  REVEAL_SIGNAL_IN_PLOT_COMMAND,
  resolveSignalFromCommandArgument
} from "./extension/signalTree";
import { reduceWorkspaceState } from "./webview/state/reducer";
import { createWorkspaceState, type WorkspaceState } from "./webview/state/workspaceState";

export const OPEN_VIEWER_COMMAND = "waveViewer.openViewer";
export const EXPORT_SPEC_COMMAND = "waveViewer.exportPlotSpec";
export const IMPORT_SPEC_COMMAND = "waveViewer.importPlotSpec";
export {
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
  | ProtocolEnvelope<"host/sidePanelQuickAdd", { signal: string }>;

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
};

export type CommandDeps = {
  extensionUri: unknown;
  getActiveDocument(): ActiveDocumentLike | undefined;
  loadDataset(documentPath: string): { dataset: Dataset; defaultXSignal: string };
  onDatasetLoaded?(documentPath: string, loaded: { dataset: Dataset; defaultXSignal: string }): void;
  getCachedWorkspace?(documentPath: string): WorkspaceState | undefined;
  setCachedWorkspace?(documentPath: string, workspace: WorkspaceState): void;
  createPanel(): WebviewPanelLike;
  onPanelCreated?(documentPath: string, panel: WebviewPanelLike): void;
  showError(message: string): void;
  logDebug?(message: string, details?: unknown): void;
  buildHtml(webview: WebviewLike, extensionUri: unknown): string;
};

export function applySidePanelSignalAction(
  workspace: WorkspaceState,
  action: SidePanelSignalAction
): WorkspaceState {
  if (action.type === "add-to-plot") {
    return reduceWorkspaceState(workspace, {
      type: "trace/add",
      payload: { signal: action.signal }
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
      payload: { signal: action.signal, axisId }
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
  payload: Extract<WebviewToHostMessage, { type: "webview/dropSignal" }>["payload"]
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
      payload: { plotId: payload.plotId, signal: payload.signal, axisId: newAxisId }
    });
  }

  if (!isAxisId(payload.target.axisId)) {
    throw new Error(`Invalid dropSignal axis id: ${payload.target.axisId}`);
  }

  return reduceWorkspaceState(nextWorkspace, {
    type: "trace/add",
    payload: { plotId: payload.plotId, signal: payload.signal, axisId: payload.target.axisId }
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
    if (!activeDocument) {
      deps.showError("Open a CSV file in the editor before launching Wave Viewer.");
      return;
    }

    if (!isCsvFile(activeDocument.fileName)) {
      deps.showError("Wave Viewer only supports active .csv files.");
      return;
    }

    let normalizedDataset: { dataset: Dataset; defaultXSignal: string };
    try {
      normalizedDataset = deps.loadDataset(activeDocument.uri.fsPath);
    } catch (error) {
      deps.showError(getErrorMessage(error));
      return;
    }
    deps.onDatasetLoaded?.(activeDocument.uri.fsPath, normalizedDataset);

    const panel = deps.createPanel();
    deps.onPanelCreated?.(activeDocument.uri.fsPath, panel);
    panel.webview.html = deps.buildHtml(panel.webview, deps.extensionUri);

    panel.webview.onDidReceiveMessage((rawMessage) => {
      const message = parseWebviewToHostMessage(rawMessage);
      if (!message) {
        deps.logDebug?.("Ignored invalid or unknown webview message.", rawMessage);
        return;
      }

      if (message.type === "webview/workspaceChanged") {
        deps.setCachedWorkspace?.(
          activeDocument.uri.fsPath,
          message.payload.workspace as WorkspaceState
        );
        return;
      }

      if (message.type === "webview/dropSignal") {
        const cachedWorkspace =
          deps.getCachedWorkspace?.(activeDocument.uri.fsPath) ??
          createWorkspaceState(normalizedDataset.defaultXSignal);

        let nextWorkspace: WorkspaceState;
        try {
          nextWorkspace = applyDropSignalAction(cachedWorkspace, message.payload);
        } catch (error) {
          deps.logDebug?.("Ignored invalid webview dropSignal message payload.", {
            payload: message.payload,
            error: getErrorMessage(error)
          });
          return;
        }

        deps.setCachedWorkspace?.(activeDocument.uri.fsPath, nextWorkspace);
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
        createProtocolEnvelope("host/datasetLoaded", {
          path: activeDocument.uri.fsPath,
          fileName: path.basename(activeDocument.fileName),
          rowCount: normalizedDataset.dataset.rowCount,
          columns: normalizedDataset.dataset.columns.map((column) => ({
            name: column.name,
            values: column.values
          })),
          defaultXSignal: normalizedDataset.defaultXSignal
        })
      );

      const cachedWorkspace = deps.getCachedWorkspace?.(activeDocument.uri.fsPath);
      if (cachedWorkspace) {
        void panel.webview.postMessage(
          createProtocolEnvelope("host/workspaceLoaded", { workspace: cachedWorkspace })
        );
      }
    });
  };
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
  const panelByDatasetPath = new Map<string, WebviewPanelLike>();
  const loadedDatasetByPath = new Map<string, { dataset: Dataset; defaultXSignal: string }>();
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
    loaded: { dataset: Dataset; defaultXSignal: string }
  ): void {
    loadedDatasetByPath.set(documentPath, loaded);
    refreshSignalTree();
  }

  function resolveLoadedDatasetPath(argumentPath: string | undefined): string | undefined {
    if (argumentPath) {
      return argumentPath;
    }

    if (loadedDatasetByPath.size === 1) {
      return loadedDatasetByPath.keys().next().value as string | undefined;
    }

    return undefined;
  }

  function runSidePanelSignalAction(actionType: SidePanelSignalAction["type"]): (item?: unknown) => void {
    return (item?: unknown) => {
      const resolved = resolveSignalFromCommandArgument(item);
      if (!resolved) {
        void vscode.window.showErrorMessage("Select a numeric signal in the Wave Viewer side panel.");
        return;
      }

      const documentPath = resolveLoadedDatasetPath(resolved.datasetPath);
      if (!documentPath) {
        void vscode.window.showErrorMessage(
          "Select a signal under a loaded CSV file in the Wave Viewer side panel."
        );
        return;
      }

      const loadedDataset = loadedDatasetByPath.get(documentPath);
      if (!loadedDataset) {
        void vscode.window.showErrorMessage(`Loaded dataset '${documentPath}' is no longer available.`);
        return;
      }

      const signals = loadedDataset.dataset.columns.map((column) => column.name);
      if (!signals.includes(resolved.signal)) {
        void vscode.window.showErrorMessage(
          `Signal '${resolved.signal}' is not available in loaded dataset '${path.basename(documentPath)}'.`
        );
        return;
      }

      const workspace =
        workspaceByDatasetPath.get(documentPath) ?? createWorkspaceState(loadedDataset.defaultXSignal);
      const nextWorkspace = applySidePanelSignalAction(workspace, { type: actionType, signal: resolved.signal });
      workspaceByDatasetPath.set(documentPath, nextWorkspace);

      const panel = panelByDatasetPath.get(documentPath);
      if (!panel) {
        return;
      }

      void panel.webview.postMessage(
        createProtocolEnvelope("host/workspacePatched", {
          workspace: nextWorkspace,
          reason: `sidePanel:${actionType}`
        })
      );
    };
  }

  const runSidePanelQuickAdd = (item?: unknown): void => {
    const resolved = resolveSignalFromCommandArgument(item);
    if (!resolved) {
      void vscode.window.showErrorMessage("Select a numeric signal in the Wave Viewer side panel.");
      return;
    }

    if (!resolveQuickAddDoubleClick(resolved)) {
      return;
    }

    const documentPath = resolveLoadedDatasetPath(resolved.datasetPath);
    if (!documentPath) {
      void vscode.window.showErrorMessage(
        "Select a signal under a loaded CSV file in the Wave Viewer side panel."
      );
      return;
    }

    const loadedDataset = loadedDatasetByPath.get(documentPath);
    if (!loadedDataset) {
      void vscode.window.showErrorMessage(`Loaded dataset '${documentPath}' is no longer available.`);
      return;
    }

    const signals = loadedDataset.dataset.columns.map((column) => column.name);
    if (!signals.includes(resolved.signal)) {
      void vscode.window.showErrorMessage(
        `Signal '${resolved.signal}' is not available in loaded dataset '${path.basename(documentPath)}'.`
      );
      return;
    }

    const panel = panelByDatasetPath.get(documentPath);
    if (!panel) {
      const workspace =
        workspaceByDatasetPath.get(documentPath) ?? createWorkspaceState(loadedDataset.defaultXSignal);
      const nextWorkspace = applySidePanelSignalAction(workspace, {
        type: "add-to-plot",
        signal: resolved.signal
      });
      workspaceByDatasetPath.set(documentPath, nextWorkspace);
      return;
    }

    void panel.webview.postMessage(
      createProtocolEnvelope("host/sidePanelQuickAdd", { signal: resolved.signal })
    );
  };

  const command = createOpenViewerCommand({
    extensionUri: context.extensionUri,
    getActiveDocument: () => vscode.window.activeTextEditor?.document,
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
    onPanelCreated: (documentPath, panel) => {
      panelByDatasetPath.set(documentPath, panel);
      panel.onDidDispose?.(() => {
        panelByDatasetPath.delete(documentPath);
      });
    },
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
}

export function deactivate(): void {
  // No-op for MVP scaffold.
}
