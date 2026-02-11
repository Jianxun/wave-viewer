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
  createSignalTreeDataProvider,
  type SignalTreeDataProvider,
  SIGNAL_BROWSER_ADD_TO_NEW_AXIS_COMMAND,
  SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND,
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
  SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND
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
  | ProtocolEnvelope<"host/workspaceLoaded", { workspace: WorkspaceState }>;

export type WebviewToHostMessage =
  | ProtocolEnvelope<"webview/ready", Record<string, unknown>>
  | ProtocolEnvelope<"webview/workspaceChanged", { workspace: WorkspaceState }>;

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
  const signalTreeProvider = createSignalTreeDataProvider(vscode);

  function setSignalTreeFromActiveCsv(): {
    documentPath: string;
    defaultXSignal: string;
    signals: readonly string[];
  } | null {
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (!activeDocument || !isCsvFile(activeDocument.fileName)) {
      signalTreeProvider.clear();
      return null;
    }

    try {
      const csvText = fs.readFileSync(activeDocument.uri.fsPath, "utf8");
      const dataset = parseCsv({ path: activeDocument.uri.fsPath, csvText });
      const signals = dataset.columns.map((column) => column.name);
      signalTreeProvider.setSignals(signals);
      const defaultXSignal = selectDefaultX(dataset);
      return { documentPath: activeDocument.uri.fsPath, defaultXSignal, signals };
    } catch {
      signalTreeProvider.clear();
      return null;
    }
  }

  function runSidePanelSignalAction(actionType: SidePanelSignalAction["type"]): (item?: unknown) => void {
    return (item?: unknown) => {
      const signal = resolveSignalFromCommandArgument(item);
      if (!signal) {
        void vscode.window.showErrorMessage("Select a numeric signal in the Wave Viewer side panel.");
        return;
      }

      const activeDatasetContext = setSignalTreeFromActiveCsv();
      if (!activeDatasetContext) {
        void vscode.window.showErrorMessage("Open an active .csv file before using Wave Viewer signals.");
        return;
      }

      if (!activeDatasetContext.signals.includes(signal)) {
        void vscode.window.showErrorMessage(`Signal '${signal}' is not available in the active dataset.`);
        return;
      }

      const workspace =
        workspaceByDatasetPath.get(activeDatasetContext.documentPath) ??
        createWorkspaceState(activeDatasetContext.defaultXSignal);
      const nextWorkspace = applySidePanelSignalAction(workspace, { type: actionType, signal });
      workspaceByDatasetPath.set(activeDatasetContext.documentPath, nextWorkspace);

      const panel = panelByDatasetPath.get(activeDatasetContext.documentPath);
      if (!panel) {
        return;
      }

      void panel.webview.postMessage(
        createProtocolEnvelope("host/workspaceLoaded", { workspace: nextWorkspace })
      );
    };
  }

  const command = createOpenViewerCommand({
    extensionUri: context.extensionUri,
    getActiveDocument: () => vscode.window.activeTextEditor?.document,
    loadDataset: (documentPath) => {
      const csvText = fs.readFileSync(documentPath, "utf8");
      const dataset = parseCsv({ path: documentPath, csvText });
      const defaultXSignal = selectDefaultX(dataset);
      return { dataset, defaultXSignal };
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

  setSignalTreeFromActiveCsv();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(SIGNAL_BROWSER_VIEW_ID, signalTreeProvider)
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      setSignalTreeFromActiveCsv();
    })
  );
  context.subscriptions.push(vscode.commands.registerCommand(OPEN_VIEWER_COMMAND, command));
  context.subscriptions.push(vscode.commands.registerCommand(EXPORT_SPEC_COMMAND, exportSpecCommand));
  context.subscriptions.push(vscode.commands.registerCommand(IMPORT_SPEC_COMMAND, importSpecCommand));
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
