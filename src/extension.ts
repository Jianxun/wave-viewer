import * as fs from "node:fs";
import * as path from "node:path";
import type * as VSCode from "vscode";

import { parseCsv } from "./core/csv/parseCsv";
import { selectDefaultX } from "./core/dataset/selectDefaultX";
import type { Dataset } from "./core/dataset/types";

export const OPEN_VIEWER_COMMAND = "waveViewer.openViewer";

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
    };

export type WebviewToHostMessage = { type: "webview/ready" };

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
  createPanel(): WebviewPanelLike;
  showError(message: string): void;
  buildHtml(webview: WebviewLike, extensionUri: unknown): string;
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
    });
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
  const command = createOpenViewerCommand({
    extensionUri: context.extensionUri,
    getActiveDocument: () => vscode.window.activeTextEditor?.document,
    loadDataset: (documentPath) => {
      const csvText = fs.readFileSync(documentPath, "utf8");
      const dataset = parseCsv({ path: documentPath, csvText });
      const defaultXSignal = selectDefaultX(dataset);
      return { dataset, defaultXSignal };
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

  context.subscriptions.push(vscode.commands.registerCommand(OPEN_VIEWER_COMMAND, command));
}

export function deactivate(): void {
  // No-op for MVP scaffold.
}
