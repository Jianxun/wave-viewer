import { describe, expect, it, vi } from "vitest";

import {
  createOpenViewerCommand,
  isCsvFile,
  OPEN_VIEWER_COMMAND,
  type CommandDeps,
  type HostToWebviewMessage,
  type WebviewLike,
  type WebviewPanelLike,
  type WebviewToHostMessage
} from "../../src/extension";

type PanelFixture = {
  panel: WebviewPanelLike;
  sentMessages: HostToWebviewMessage[];
  emitMessage(message: WebviewToHostMessage): void;
};

function createPanelFixture(): PanelFixture {
  let listener: ((message: WebviewToHostMessage) => void) | undefined;
  const sentMessages: HostToWebviewMessage[] = [];

  const webview: WebviewLike = {
    html: "",
    cspSource: "vscode-resource:",
    asWebviewUri: () => "vscode-resource:/dist/webview/main.js",
    postMessage: async (message) => {
      sentMessages.push(message);
      return true;
    },
    onDidReceiveMessage: (handler) => {
      listener = handler;
    }
  };

  return {
    panel: { webview },
    sentMessages,
    emitMessage: (message) => {
      listener?.(message);
    }
  };
}

function createDeps(overrides?: {
  fileName?: string;
  hasActiveDocument?: boolean;
  panelFixture?: PanelFixture;
  buildHtml?: string;
  loadDatasetError?: string;
}): { deps: CommandDeps; panelFixture: PanelFixture; showError: ReturnType<typeof vi.fn> } {
  const panelFixture = overrides?.panelFixture ?? createPanelFixture();
  const showError = vi.fn();
  const hasActiveDocument = overrides?.hasActiveDocument ?? true;

  const deps: CommandDeps = {
    extensionUri: { path: "/workspace" },
    getActiveDocument: () => {
      if (!hasActiveDocument) {
        return undefined;
      }

      const fileName = overrides?.fileName ?? "/workspace/examples/simulations/ota.spice.csv";
      return {
        fileName,
        uri: {
          fsPath: fileName
        }
      };
    },
    loadDataset: () => {
      if (overrides?.loadDatasetError) {
        throw new Error(overrides.loadDatasetError);
      }
      return {
        dataset: {
          path: "/workspace/examples/simulations/ota.spice.csv",
          rowCount: 3,
          columns: [
            { name: "time", values: [0, 1, 2] },
            { name: "vin", values: [1, 2, 3] }
          ]
        },
        defaultXSignal: "time"
      };
    },
    createPanel: () => panelFixture.panel,
    showError,
    buildHtml: () => overrides?.buildHtml ?? "<html>shell</html>"
  };

  return { deps, panelFixture, showError };
}

describe("T-002 extension shell smoke", () => {
  it("exports the command id", () => {
    expect(OPEN_VIEWER_COMMAND).toBe("waveViewer.openViewer");
  });

  it("detects csv files", () => {
    expect(isCsvFile("a.csv")).toBe(true);
    expect(isCsvFile("A.CSV")).toBe(true);
    expect(isCsvFile("a.txt")).toBe(false);
  });

  it("shows a clear error when no active editor exists", async () => {
    const { deps, showError } = createDeps({ hasActiveDocument: false });

    await createOpenViewerCommand(deps)();

    expect(showError).toHaveBeenCalledWith(
      "Open a CSV file in the editor before launching Wave Viewer."
    );
  });

  it("shows a clear error when active editor is not csv", async () => {
    const { deps, showError } = createDeps({ fileName: "/workspace/notes.md" });

    await createOpenViewerCommand(deps)();

    expect(showError).toHaveBeenCalledWith("Wave Viewer only supports active .csv files.");
  });

  it("surfaces parser/load errors before opening the panel", async () => {
    const { deps, panelFixture, showError } = createDeps({
      loadDatasetError: "Malformed CSV row 7 in /workspace/examples/simulations/ota.spice.csv."
    });

    await createOpenViewerCommand(deps)();

    expect(showError).toHaveBeenCalledWith(
      "Malformed CSV row 7 in /workspace/examples/simulations/ota.spice.csv."
    );
    expect(panelFixture.panel.webview.html).toBe("");
    expect(panelFixture.sentMessages).toEqual([]);
  });

  it("loads webview shell and posts init + dataset events after ready", async () => {
    const { deps, panelFixture, showError } = createDeps();

    await createOpenViewerCommand(deps)();

    expect(showError).not.toHaveBeenCalled();
    expect(panelFixture.panel.webview.html).toContain("<html>shell</html>");

    panelFixture.emitMessage({ type: "webview/ready" });

    expect(panelFixture.sentMessages).toEqual([
      {
        type: "host/init",
        payload: { title: "Wave Viewer" }
      },
      {
        type: "host/datasetLoaded",
        payload: {
          path: "/workspace/examples/simulations/ota.spice.csv",
          fileName: "ota.spice.csv",
          rowCount: 3,
          columns: [
            { name: "time", values: [0, 1, 2] },
            { name: "vin", values: [1, 2, 3] }
          ],
          defaultXSignal: "time"
        }
      }
    ]);
  });
});
