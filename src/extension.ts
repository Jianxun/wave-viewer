import * as fs from "node:fs";
import * as path from "node:path";
import type * as VSCode from "vscode";

import { exportPlotSpecV1 } from "./core/spec/exportSpec";
import { importPlotSpecV1 } from "./core/spec/importSpec";
import { parseCsv } from "./core/csv/parseCsv";
import { selectDefaultX } from "./core/dataset/selectDefaultX";
import type { Dataset } from "./core/dataset/types";
import { createWorkspaceState, type WorkspaceState } from "./webview/state/workspaceState";

export const OPEN_VIEWER_COMMAND = "waveViewer.openViewer";
export const EXPORT_SPEC_COMMAND = "waveViewer.exportPlotSpec";
export const IMPORT_SPEC_COMMAND = "waveViewer.importPlotSpec";

export type HostToWebviewMessage =
  | { type: "host/init"; payload: { title: string } }
  | {
      type: "host/datasetLoaded";
      payload: {
        path: string;
        fileName: string;
        rowCount: number;
        columns: Array<{ name: string; values: number[] }>;
        defaultXSignal: string;
      };
    }
  | { type: "host/workspaceLoaded"; payload: { workspace: WorkspaceState } };

export type WebviewToHostMessage =
  | { type: "webview/ready" }
  | {
      type: "webview/workspaceChanged";
      payload: { workspace: WorkspaceState };
    };

export type ActiveDocumentLike = {
  fileName: string;
  uri: { fsPath: string };
};

export type WebviewLike = {
  html: string;
  cspSource: string;
  asWebviewUri(uri: unknown): string;
  postMessage(message: HostToWebviewMessage): Promise<boolean>;
  onDidReceiveMessage(handler: (message: WebviewToHostMessage) => void): void;
};

export type WebviewPanelLike = {
  webview: WebviewLike;
};

export type CommandDeps = {
  extensionUri: unknown;
  getActiveDocument(): ActiveDocumentLike | undefined;
  loadDataset(documentPath: string): { dataset: Dataset; defaultXSignal: string };
  getCachedWorkspace?(documentPath: string): WorkspaceState | undefined;
  setCachedWorkspace?(documentPath: string, workspace: WorkspaceState): void;
  createPanel(): WebviewPanelLike;
  showError(message: string): void;
  buildHtml(webview: WebviewLike, extensionUri: unknown): string;
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
    panel.webview.html = deps.buildHtml(panel.webview, deps.extensionUri);

    panel.webview.onDidReceiveMessage((message) => {
      if (message.type === "webview/workspaceChanged") {
        deps.setCachedWorkspace?.(activeDocument.uri.fsPath, message.payload.workspace);
        return;
      }

      if (message.type !== "webview/ready") {
        return;
      }

      void panel.webview.postMessage({
        type: "host/init",
        payload: { title: "Wave Viewer" }
      });

      void panel.webview.postMessage({
        type: "host/datasetLoaded",
        payload: {
          path: activeDocument.uri.fsPath,
          fileName: path.basename(activeDocument.fileName),
          rowCount: normalizedDataset.dataset.rowCount,
          columns: normalizedDataset.dataset.columns.map((column) => ({
            name: column.name,
            values: column.values
          })),
          defaultXSignal: normalizedDataset.defaultXSignal
        }
      });

      const cachedWorkspace = deps.getCachedWorkspace?.(activeDocument.uri.fsPath);
      if (cachedWorkspace) {
        void panel.webview.postMessage({
          type: "host/workspaceLoaded",
          payload: { workspace: cachedWorkspace }
        });
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
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
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

  context.subscriptions.push(vscode.commands.registerCommand(OPEN_VIEWER_COMMAND, command));
  context.subscriptions.push(vscode.commands.registerCommand(EXPORT_SPEC_COMMAND, exportSpecCommand));
  context.subscriptions.push(vscode.commands.registerCommand(IMPORT_SPEC_COMMAND, importSpecCommand));
}

export function deactivate(): void {
  // No-op for MVP scaffold.
}
