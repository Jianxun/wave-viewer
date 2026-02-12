import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { PROTOCOL_VERSION, createProtocolEnvelope } from "../../src/core/dataset/types";
import {
  applyDropSignalAction,
  applySidePanelSignalAction,
  createViewerSessionRegistry,
  createNoTargetViewerWarning,
  createLoadCsvFilesCommand,
  createOpenViewerCommand,
  createRemoveLoadedFileCommand,
  createReloadAllLoadedFilesCommand,
  isCsvFile,
  LOAD_CSV_FILES_COMMAND,
  OPEN_VIEWER_COMMAND,
  REMOVE_LOADED_FILE_COMMAND,
  REVEAL_SIGNAL_IN_PLOT_COMMAND,
  RELOAD_ALL_FILES_COMMAND,
  SIGNAL_BROWSER_QUICK_ADD_COMMAND,
  SIGNAL_BROWSER_ADD_TO_NEW_AXIS_COMMAND,
  SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND,
  runResolvedSidePanelSignalAction,
  resolveSidePanelSelection,
  type CommandDeps,
  type HostToWebviewMessage,
  type LoadedDatasetRecord,
  type ViewerSessionRegistry,
  type WebviewLike,
  type WebviewPanelLike
} from "../../src/extension";
import { toDeterministicSignalOrder } from "../../src/extension/signalTree";
import type { WorkspaceState } from "../../src/webview/state/workspaceState";

type PanelFixture = {
  panel: WebviewPanelLike;
  sentMessages: HostToWebviewMessage[];
  emitMessage(message: unknown): void;
};

function createPanelFixture(): PanelFixture {
  let listener: ((message: unknown) => void) | undefined;
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

function createRegistryPanelFixture(): {
  panel: WebviewPanelLike;
  emitDispose(): void;
  emitFocus(active?: boolean): void;
} {
  let disposeListener: (() => void) | undefined;
  let focusListener:
    | ((event: { webviewPanel: WebviewPanelLike; active: boolean; visible: boolean }) => void)
    | undefined;
  const panel: WebviewPanelLike = {
    webview: {
      html: "",
      cspSource: "vscode-resource:",
      asWebviewUri: () => "vscode-resource:/dist/webview/main.js",
      postMessage: async () => true,
      onDidReceiveMessage: () => undefined
    },
    onDidDispose: (listener) => {
      disposeListener = listener;
    },
    onDidChangeViewState: (listener) => {
      focusListener = listener;
    }
  };

  return {
    panel,
    emitDispose: () => {
      disposeListener?.();
    },
    emitFocus: (active = true) => {
      focusListener?.({ webviewPanel: panel, active, visible: true });
    }
  };
}

function createDeps(overrides?: {
  fileName?: string;
  hasActiveDocument?: boolean;
  preferredDatasetPath?: string;
  panelFixture?: PanelFixture;
  buildHtml?: string;
  loadDatasetError?: string;
  initialWorkspace?: WorkspaceState;
  onDatasetLoaded?: ReturnType<typeof vi.fn>;
}): {
  deps: CommandDeps;
  panelFixture: PanelFixture;
  showError: ReturnType<typeof vi.fn>;
  logDebug: ReturnType<typeof vi.fn>;
  getCachedWorkspace: ReturnType<typeof vi.fn>;
  setCachedWorkspace: ReturnType<typeof vi.fn>;
} {
  const panelFixture = overrides?.panelFixture ?? createPanelFixture();
  const showError = vi.fn();
  const logDebug = vi.fn();
  const hasActiveDocument = overrides?.hasActiveDocument ?? true;
  let cachedWorkspace = overrides?.initialWorkspace;
  const getCachedWorkspace = vi.fn(() => cachedWorkspace);
  const setCachedWorkspace = vi.fn((_documentPath: string, workspace: WorkspaceState) => {
    cachedWorkspace = workspace;
  });

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
    getPreferredDatasetPath: () => overrides?.preferredDatasetPath,
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
    getCachedWorkspace,
    setCachedWorkspace,
    showError,
    logDebug,
    buildHtml: () => overrides?.buildHtml ?? "<html>shell</html>"
  };
  if (overrides?.onDatasetLoaded) {
    deps.onDatasetLoaded = overrides.onDatasetLoaded;
  }

  return { deps, panelFixture, showError, logDebug, getCachedWorkspace, setCachedWorkspace };
}

function createWorkspaceFixture(): WorkspaceState {
  return {
    activePlotId: "plot-1",
    plots: [
      {
        id: "plot-1",
        name: "Plot 1",
        xSignal: "time",
        axes: [{ id: "y1" }],
        traces: [],
        nextAxisNumber: 2
      }
    ]
  };
}

function createLoadedDatasetFixture(
  datasetPath = "/workspace/examples/simulations/ota.spice.csv"
): LoadedDatasetRecord {
  return {
    dataset: {
      path: datasetPath,
      rowCount: 3,
      columns: [
        { name: "time", values: [0, 1, 2] },
        { name: "vin", values: [1, 2, 3] }
      ]
    },
    defaultXSignal: "time"
  };
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

    expect(showError).not.toHaveBeenCalled();
  });

  it("does not require an active csv editor to open the viewer shell", async () => {
    const { deps, showError } = createDeps({ fileName: "/workspace/notes.md" });

    await createOpenViewerCommand(deps)();

    expect(showError).not.toHaveBeenCalled();
  });

  it("falls back to preferred loaded dataset path when active editor is not csv", async () => {
    const onDatasetLoaded = vi.fn();
    const { deps, panelFixture, showError } = createDeps({
      fileName: "/workspace/notes.md",
      preferredDatasetPath: "/workspace/examples/simulations/ota.spice.csv",
      onDatasetLoaded
    });

    await createOpenViewerCommand(deps)();
    panelFixture.emitMessage(createProtocolEnvelope("webview/ready", { ready: true }));

    expect(showError).not.toHaveBeenCalled();
    expect(onDatasetLoaded).toHaveBeenCalledWith("/workspace/examples/simulations/ota.spice.csv", {
      dataset: {
        path: "/workspace/examples/simulations/ota.spice.csv",
        rowCount: 3,
        columns: [
          { name: "time", values: [0, 1, 2] },
          { name: "vin", values: [1, 2, 3] }
        ]
      },
      defaultXSignal: "time"
    });
    expect(panelFixture.sentMessages[1]).toEqual({
      version: PROTOCOL_VERSION,
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
    });
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

    panelFixture.emitMessage(createProtocolEnvelope("webview/ready", { ready: true }));

    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/init",
        payload: { title: "Wave Viewer" }
      },
      {
        version: PROTOCOL_VERSION,
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

    const datasetMessage = panelFixture.sentMessages[1];
    expect(datasetMessage?.type).toBe("host/datasetLoaded");
    expect(datasetMessage?.payload).not.toHaveProperty("layout");
    expect(datasetMessage?.payload).not.toHaveProperty("axes");
  });

  it("posts init only when opened without a dataset context", async () => {
    const { deps, panelFixture, showError } = createDeps({ hasActiveDocument: false });

    await createOpenViewerCommand(deps)();
    panelFixture.emitMessage(createProtocolEnvelope("webview/ready", { ready: true }));

    expect(showError).not.toHaveBeenCalled();
    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/init",
        payload: { title: "Wave Viewer" }
      }
    ]);
  });

  it("registers loaded dataset context when open viewer parses a csv", async () => {
    const onDatasetLoaded = vi.fn();
    const { deps } = createDeps({ onDatasetLoaded });

    await createOpenViewerCommand(deps)();

    expect(onDatasetLoaded).toHaveBeenCalledWith("/workspace/examples/simulations/ota.spice.csv", {
      dataset: {
        path: "/workspace/examples/simulations/ota.spice.csv",
        rowCount: 3,
        columns: [
          { name: "time", values: [0, 1, 2] },
          { name: "vin", values: [1, 2, 3] }
        ]
      },
      defaultXSignal: "time"
    });
  });

  it("ignores unknown inbound messages without posting responses", async () => {
    const { deps, panelFixture } = createDeps();

    await createOpenViewerCommand(deps)();
    panelFixture.emitMessage(createProtocolEnvelope("webview/unknown", { whatever: true }));

    expect(panelFixture.sentMessages).toEqual([]);
  });
});

describe("T-013 side-panel signal actions", () => {
  it("exports side-panel command ids", () => {
    expect(SIGNAL_BROWSER_QUICK_ADD_COMMAND).toBe("waveViewer.signalBrowser.quickAdd");
    expect(SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND).toBe("waveViewer.signalBrowser.addToPlot");
    expect(SIGNAL_BROWSER_ADD_TO_NEW_AXIS_COMMAND).toBe("waveViewer.signalBrowser.addToNewAxis");
    expect(REVEAL_SIGNAL_IN_PLOT_COMMAND).toBe("waveViewer.signalBrowser.revealInPlot");
    expect(LOAD_CSV_FILES_COMMAND).toBe("waveViewer.signalBrowser.loadCsvFiles");
    expect(RELOAD_ALL_FILES_COMMAND).toBe("waveViewer.signalBrowser.reloadAllFiles");
    expect(REMOVE_LOADED_FILE_COMMAND).toBe("waveViewer.signalBrowser.removeLoadedFile");
  });

  it("applies add-to-plot through reducer-compatible trace append", () => {
    const next = applySidePanelSignalAction(
      {
        activePlotId: "plot-1",
        plots: [
          {
            id: "plot-1",
            name: "Plot 1",
            xSignal: "time",
            axes: [{ id: "y1" }],
            traces: [],
            nextAxisNumber: 2
          }
        ]
      },
      { type: "add-to-plot", signal: "vin" }
    );

    expect(next.plots[0]?.traces).toEqual([
      {
        id: "trace-1",
        signal: "vin",
        axisId: "y1",
        visible: true
      }
    ]);
  });

  it("applies add-to-new-axis by appending one axis and one trace bound to it", () => {
    const next = applySidePanelSignalAction(
      {
        activePlotId: "plot-1",
        plots: [
          {
            id: "plot-1",
            name: "Plot 1",
            xSignal: "time",
            axes: [{ id: "y1" }],
            traces: [],
            nextAxisNumber: 2
          }
        ]
      },
      { type: "add-to-new-axis", signal: "vin" }
    );

    expect(next.plots[0]?.axes.map((axis) => axis.id)).toEqual(["y1", "y2"]);
    expect(next.plots[0]?.traces).toEqual([
      {
        id: "trace-1",
        signal: "vin",
        axisId: "y2",
        visible: true
      }
    ]);
  });

  it("reveals signal by activating the first plot that already contains it", () => {
    const next = applySidePanelSignalAction(
      {
        activePlotId: "plot-1",
        plots: [
          {
            id: "plot-1",
            name: "Plot 1",
            xSignal: "time",
            axes: [{ id: "y1" }],
            traces: [],
            nextAxisNumber: 2
          },
          {
            id: "plot-2",
            name: "Plot 2",
            xSignal: "time",
            axes: [{ id: "y1" }],
            traces: [{ id: "trace-1", signal: "vin", axisId: "y1", visible: false }],
            nextAxisNumber: 2
          }
        ]
      },
      { type: "reveal-in-plot", signal: "vin" }
    );

    expect(next.activePlotId).toBe("plot-2");
    expect(next.plots[1]?.traces[0]?.visible).toBe(true);
  });

  it("keeps signal order deterministic by source column order", () => {
    expect(toDeterministicSignalOrder(["time", "vin", "vout"])).toEqual(["time", "vin", "vout"]);
  });
});

describe("T-021 explorer load/reload actions", () => {
  it("loads one or more csv files selected from picker into dataset registry", async () => {
    const registerLoadedDataset = vi.fn();
    const showError = vi.fn();
    const command = createLoadCsvFilesCommand({
      showOpenDialog: async () => ["/workspace/examples/a.csv", "/workspace/examples/b.csv"],
      loadDataset: (documentPath) => ({
        dataset: {
          path: documentPath,
          rowCount: 2,
          columns: [{ name: "time", values: [0, 1] }]
        },
        defaultXSignal: "time"
      }),
      registerLoadedDataset,
      showError
    });

    await command();

    expect(registerLoadedDataset).toHaveBeenCalledTimes(2);
    expect(registerLoadedDataset).toHaveBeenNthCalledWith(1, "/workspace/examples/a.csv", {
      dataset: {
        path: "/workspace/examples/a.csv",
        rowCount: 2,
        columns: [{ name: "time", values: [0, 1] }]
      },
      defaultXSignal: "time"
    });
    expect(registerLoadedDataset).toHaveBeenNthCalledWith(2, "/workspace/examples/b.csv", {
      dataset: {
        path: "/workspace/examples/b.csv",
        rowCount: 2,
        columns: [{ name: "time", values: [0, 1] }]
      },
      defaultXSignal: "time"
    });
    expect(showError).not.toHaveBeenCalled();
  });

  it("surfaces actionable errors when selected csv fails parse while keeping valid loads", async () => {
    const registerLoadedDataset = vi.fn();
    const showError = vi.fn();
    const command = createLoadCsvFilesCommand({
      showOpenDialog: async () => ["/workspace/examples/a.csv", "/workspace/examples/bad.csv"],
      loadDataset: (documentPath) => {
        if (documentPath.endsWith("bad.csv")) {
          throw new Error("Malformed CSV row 7.");
        }
        return {
          dataset: {
            path: documentPath,
            rowCount: 2,
            columns: [{ name: "time", values: [0, 1] }]
          },
          defaultXSignal: "time"
        };
      },
      registerLoadedDataset,
      showError
    });

    await command();

    expect(registerLoadedDataset).toHaveBeenCalledTimes(1);
    expect(registerLoadedDataset).toHaveBeenCalledWith("/workspace/examples/a.csv", {
      dataset: {
        path: "/workspace/examples/a.csv",
        rowCount: 2,
        columns: [{ name: "time", values: [0, 1] }]
      },
      defaultXSignal: "time"
    });
    expect(showError).toHaveBeenCalledWith(
      "Failed to load '/workspace/examples/bad.csv': Malformed CSV row 7."
    );
  });

  it("reloads all loaded files and preserves already-loaded datasets on parse failures", async () => {
    const registerLoadedDataset = vi.fn();
    const showError = vi.fn();
    const command = createReloadAllLoadedFilesCommand({
      getLoadedDatasetPaths: () => ["/workspace/examples/a.csv", "/workspace/examples/bad.csv"],
      loadDataset: (documentPath) => {
        if (documentPath.endsWith("bad.csv")) {
          throw new Error("File missing.");
        }
        return {
          dataset: {
            path: documentPath,
            rowCount: 5,
            columns: [{ name: "time", values: [0, 1, 2, 3, 4] }]
          },
          defaultXSignal: "time"
        };
      },
      registerLoadedDataset,
      showError
    });

    await command();

    expect(registerLoadedDataset).toHaveBeenCalledTimes(1);
    expect(registerLoadedDataset).toHaveBeenCalledWith("/workspace/examples/a.csv", {
      dataset: {
        path: "/workspace/examples/a.csv",
        rowCount: 5,
        columns: [{ name: "time", values: [0, 1, 2, 3, 4] }]
      },
      defaultXSignal: "time"
    });
    expect(showError).toHaveBeenCalledWith(
      "Failed to reload '/workspace/examples/bad.csv': File missing."
    );
  });
});

describe("T-022 explorer remove loaded file action", () => {
  it("removes exactly one loaded dataset and keeps unrelated datasets", () => {
    const loadedPaths = new Set([
      "/workspace/examples/a.csv",
      "/workspace/examples/b.csv",
      "/workspace/examples/c.csv"
    ]);
    const showError = vi.fn();
    const showWarning = vi.fn();
    const markDatasetAsRemoved = vi.fn();
    const command = createRemoveLoadedFileCommand({
      removeLoadedDataset: (documentPath) => loadedPaths.delete(documentPath),
      hasOpenPanel: () => false,
      markDatasetAsRemoved,
      showError,
      showWarning
    });

    command({ datasetPath: "/workspace/examples/b.csv" });

    expect(Array.from(loadedPaths)).toEqual([
      "/workspace/examples/a.csv",
      "/workspace/examples/c.csv"
    ]);
    expect(markDatasetAsRemoved).toHaveBeenCalledWith("/workspace/examples/b.csv");
    expect(showError).not.toHaveBeenCalled();
    expect(showWarning).not.toHaveBeenCalled();
  });

  it("shows warning when removing a file that still has an open viewer panel", () => {
    const showError = vi.fn();
    const showWarning = vi.fn();
    const command = createRemoveLoadedFileCommand({
      removeLoadedDataset: () => true,
      hasOpenPanel: () => true,
      markDatasetAsRemoved: vi.fn(),
      showError,
      showWarning
    });

    command({ datasetPath: "/workspace/examples/b.csv" });

    expect(showError).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledWith(
      "Removed 'b.csv' from loaded files. Its open viewer remains available, but side-panel signal adds are blocked until this file is loaded again."
    );
  });

  it("shows an error when removing a dataset that is no longer loaded", () => {
    const showError = vi.fn();
    const showWarning = vi.fn();
    const markDatasetAsRemoved = vi.fn();
    const command = createRemoveLoadedFileCommand({
      removeLoadedDataset: () => false,
      hasOpenPanel: () => false,
      markDatasetAsRemoved,
      showError,
      showWarning
    });

    command({ datasetPath: "/workspace/examples/missing.csv" });

    expect(markDatasetAsRemoved).not.toHaveBeenCalled();
    expect(showWarning).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(
      "Loaded dataset '/workspace/examples/missing.csv' is no longer available."
    );
  });
});

describe("T-022 follow-up signal actions after remove", () => {
  it("blocks side-panel signal actions for removed datasets with warning", () => {
    const showError = vi.fn();
    const showWarning = vi.fn();
    const selection = resolveSidePanelSelection({
      selection: { signal: "vin", datasetPath: "/workspace/examples/removed.csv" },
      getLoadedDataset: () => undefined,
      getSingleLoadedDatasetPath: () => undefined,
      wasDatasetRemoved: () => true,
      showError,
      showWarning
    });

    expect(selection).toBeUndefined();
    expect(showError).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledWith(
      "CSV file 'removed.csv' was removed from loaded files. Load it again before using side-panel signal actions."
    );
  });
});

describe("T-018 normalized protocol handling", () => {
  it("handles validated dropSignal by caching and posting workspacePatched", async () => {
    const { deps, panelFixture, setCachedWorkspace } = createDeps({
      initialWorkspace: createWorkspaceFixture()
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/dropSignal", {
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis", axisId: "y1" },
        source: "axis-row"
      })
    );

    expect(setCachedWorkspace).toHaveBeenCalledTimes(1);
    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/workspacePatched",
        payload: {
          workspace: {
            activePlotId: "plot-1",
            plots: [
              {
                id: "plot-1",
                name: "Plot 1",
                xSignal: "time",
                axes: [{ id: "y1" }],
                traces: [{ id: "trace-1", signal: "vin", axisId: "y1", visible: true }],
                nextAxisNumber: 2
              }
            ]
          },
          reason: "dropSignal:axis-row"
        }
      }
    ]);
  });

  it("ignores invalid dropSignal payloads and does not mutate workspace", async () => {
    const { deps, panelFixture, logDebug, setCachedWorkspace } = createDeps({
      initialWorkspace: createWorkspaceFixture()
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/dropSignal", {
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis" },
        source: "axis-row"
      })
    );

    expect(setCachedWorkspace).not.toHaveBeenCalled();
    expect(panelFixture.sentMessages).toEqual([]);
    expect(logDebug).toHaveBeenCalledWith(
      "Ignored invalid or unknown webview message.",
      expect.objectContaining({
        type: "webview/dropSignal"
      })
    );
  });

  it("keeps reducer outcomes deterministic for equivalent add intents", () => {
    const initial = createWorkspaceFixture();
    const fromSidePanel = applySidePanelSignalAction(initial, { type: "add-to-plot", signal: "vin" });
    const fromDropSignal = applyDropSignalAction(initial, {
      signal: "vin",
      plotId: "plot-1",
      target: { kind: "axis", axisId: "y1" },
      source: "axis-row"
    });

    expect(fromDropSignal).toEqual(fromSidePanel);
  });

  it("keeps equivalent workspace outcomes across side-panel, axis-row drop, and canvas-overlay drop", () => {
    const fromSidePanel = applySidePanelSignalAction(createWorkspaceFixture(), {
      type: "add-to-plot",
      signal: "vin"
    });
    const fromAxisRowDrop = applyDropSignalAction(createWorkspaceFixture(), {
      signal: "vin",
      plotId: "plot-1",
      target: { kind: "axis", axisId: "y1" },
      source: "axis-row"
    });
    const fromCanvasOverlayDrop = applyDropSignalAction(createWorkspaceFixture(), {
      signal: "vin",
      plotId: "plot-1",
      target: { kind: "axis", axisId: "y1" },
      source: "canvas-overlay"
    });

    expect(fromAxisRowDrop).toEqual(fromSidePanel);
    expect(fromCanvasOverlayDrop).toEqual(fromSidePanel);
    expect(fromCanvasOverlayDrop).toEqual(fromAxisRowDrop);
  });

  it("handles dropSignal new-axis target by creating one axis and binding the dropped trace", () => {
    const next = applyDropSignalAction(createWorkspaceFixture(), {
      signal: "vin",
      plotId: "plot-1",
      target: { kind: "new-axis" },
      source: "axis-row"
    });

    expect(next.plots[0]?.axes.map((axis) => axis.id)).toEqual(["y1", "y2"]);
    expect(next.plots[0]?.traces).toEqual([
      {
        id: "trace-1",
        signal: "vin",
        axisId: "y2",
        visible: true
      }
    ]);
  });

  it("keeps equivalent new-axis workspace outcomes across side-panel and both drop sources", () => {
    const fromSidePanel = applySidePanelSignalAction(createWorkspaceFixture(), {
      type: "add-to-new-axis",
      signal: "vin"
    });
    const fromAxisRowDrop = applyDropSignalAction(createWorkspaceFixture(), {
      signal: "vin",
      plotId: "plot-1",
      target: { kind: "new-axis" },
      source: "axis-row"
    });
    const fromCanvasOverlayDrop = applyDropSignalAction(createWorkspaceFixture(), {
      signal: "vin",
      plotId: "plot-1",
      target: { kind: "new-axis" },
      source: "canvas-overlay"
    });

    expect(fromAxisRowDrop).toEqual(fromSidePanel);
    expect(fromCanvasOverlayDrop).toEqual(fromSidePanel);
    expect(fromCanvasOverlayDrop).toEqual(fromAxisRowDrop);
  });

  it("handles canvas-overlay dropSignal source and records source-specific patch reason", async () => {
    const { deps, panelFixture, setCachedWorkspace } = createDeps({
      initialWorkspace: createWorkspaceFixture()
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/dropSignal", {
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis", axisId: "y1" },
        source: "canvas-overlay"
      })
    );

    expect(setCachedWorkspace).toHaveBeenCalledTimes(1);
    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/workspacePatched",
        payload: {
          workspace: {
            activePlotId: "plot-1",
            plots: [
              {
                id: "plot-1",
                name: "Plot 1",
                xSignal: "time",
                axes: [{ id: "y1" }],
                traces: [{ id: "trace-1", signal: "vin", axisId: "y1", visible: true }],
                nextAxisNumber: 2
              }
            ]
          },
          reason: "dropSignal:canvas-overlay"
        }
      }
    ]);
  });
});

describe("T-023 canvas drop overlay interaction safety", () => {
  it("keeps overlay non-interactive outside active drag lifecycle", () => {
    const css = fs.readFileSync(path.resolve("src/webview/styles.css"), "utf8");

    expect(css).toMatch(/\.plot-drop-overlay\s*\{[\s\S]*?pointer-events:\s*none;/);
    expect(css).toMatch(/\.plot-drop-overlay\.drag-active\s*\{[\s\S]*?pointer-events:\s*auto;/);
    expect(css).toMatch(/\.plot-drop-lane\s*\{[\s\S]*?pointer-events:\s*none;/);
  });

  it("gates canvas overlay activation to drag lifecycle events only", () => {
    const source = fs.readFileSync(path.resolve("src/webview/main.ts"), "utf8");

    expect(source).toContain("function setCanvasDropOverlayActive(active: boolean): void");
    expect(source).toContain('plotDropOverlayEl.classList.toggle("drag-active", active);');
    expect(source).toContain('plotCanvasEl.addEventListener("dragenter"');
    expect(source).toContain('plotCanvasEl.addEventListener("dragover"');
    expect(source).toContain('plotCanvasEl.addEventListener("dragleave"');
    expect(source).toContain('plotCanvasEl.addEventListener("drop"');
  });
});

describe("T-025 standalone viewer side-panel routing", () => {
  it("binds a standalone viewer to dataset action and posts datasetLoaded before patch", () => {
    const panelFixture = createPanelFixture();
    const showWarning = vi.fn();
    const bindPanelToDataset = vi.fn();
    let standalonePanel: WebviewPanelLike | undefined = panelFixture.panel;
    let cachedWorkspace: WorkspaceState | undefined;

    const nextWorkspace = runResolvedSidePanelSignalAction({
      actionType: "add-to-plot",
      documentPath: "/workspace/examples/simulations/ota.spice.csv",
      loadedDataset: createLoadedDatasetFixture(),
      signal: "vin",
      getCachedWorkspace: () => cachedWorkspace,
      setCachedWorkspace: (_documentPath, workspace) => {
        cachedWorkspace = workspace;
      },
      getBoundPanel: () => undefined,
      getStandalonePanel: () => standalonePanel,
      bindPanelToDataset: (_documentPath, panel) => {
        bindPanelToDataset();
        expect(panel).toBe(panelFixture.panel);
      },
      clearStandalonePanel: (panel) => {
        if (standalonePanel === panel) {
          standalonePanel = undefined;
        }
      },
      showWarning
    });

    expect(showWarning).not.toHaveBeenCalled();
    expect(bindPanelToDataset).toHaveBeenCalledTimes(1);
    expect(standalonePanel).toBeUndefined();
    expect(nextWorkspace.plots[0]?.traces).toEqual([
      { id: "trace-1", signal: "vin", axisId: "y1", visible: true }
    ]);
    expect(panelFixture.sentMessages.map((message) => message.type)).toEqual([
      "host/datasetLoaded",
      "host/workspacePatched"
    ]);
    expect(panelFixture.sentMessages[0]).toEqual({
      version: PROTOCOL_VERSION,
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
    });
    expect(panelFixture.sentMessages[1]).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/workspacePatched",
      payload: {
        workspace: nextWorkspace,
        reason: "sidePanel:add-to-plot"
      }
    });
  });

  it("shows actionable warning when no viewer target can accept the action", () => {
    const showWarning = vi.fn();
    const nextWorkspace = runResolvedSidePanelSignalAction({
      actionType: "add-to-plot",
      documentPath: "/workspace/examples/simulations/ota.spice.csv",
      loadedDataset: createLoadedDatasetFixture(),
      signal: "vin",
      getCachedWorkspace: () => undefined,
      setCachedWorkspace: () => undefined,
      getBoundPanel: () => undefined,
      getStandalonePanel: () => undefined,
      bindPanelToDataset: () => undefined,
      clearStandalonePanel: () => undefined,
      showWarning
    });

    expect(nextWorkspace.plots[0]?.traces).toEqual([
      { id: "trace-1", signal: "vin", axisId: "y1", visible: true }
    ]);
    expect(showWarning).toHaveBeenCalledWith(
      createNoTargetViewerWarning("add-to-plot", "/workspace/examples/simulations/ota.spice.csv")
    );
    expect(createNoTargetViewerWarning("add-to-plot", "/workspace/examples/simulations/ota.spice.csv"))
      .toContain("Open Wave Viewer for that CSV and retry.");
  });
});

describe("T-026 viewer session registry", () => {
  function selectTarget(registry: ViewerSessionRegistry, datasetPath: string): string | undefined {
    return registry.resolveTargetViewerSession(datasetPath)?.viewerId;
  }

  it("routes to focused viewer for a dataset when multiple viewers are bound", () => {
    const registry = createViewerSessionRegistry();
    const panelA = createRegistryPanelFixture();
    const panelB = createRegistryPanelFixture();
    const viewerA = registry.registerPanel(panelA.panel, "/workspace/examples/a.csv");
    const viewerB = registry.registerPanel(panelB.panel, "/workspace/examples/a.csv");

    expect(selectTarget(registry, "/workspace/examples/a.csv")).toBe(viewerB);

    registry.markViewerFocused(viewerA);
    expect(selectTarget(registry, "/workspace/examples/a.csv")).toBe(viewerA);
  });

  it("uses focused standalone viewer as deterministic bind target before dataset-bound fallback", () => {
    const registry = createViewerSessionRegistry();
    const boundPanel = createRegistryPanelFixture();
    const standalonePanel = createRegistryPanelFixture();
    const boundViewer = registry.registerPanel(boundPanel.panel, "/workspace/examples/a.csv");
    const standaloneViewer = registry.registerPanel(standalonePanel.panel);

    registry.markViewerFocused(standaloneViewer);
    const target = registry.resolveTargetViewerSession("/workspace/examples/a.csv");

    expect(target?.viewerId).toBe(standaloneViewer);
    expect(target?.bindDataset).toBe(true);

    registry.markViewerFocused(boundViewer);
    const rebound = registry.resolveTargetViewerSession("/workspace/examples/a.csv");
    expect(rebound?.viewerId).toBe(boundViewer);
    expect(rebound?.bindDataset).toBe(false);
  });

  it("cleans dataset and active-session indexes when a viewer is disposed", () => {
    const registry = createViewerSessionRegistry();
    const panelA = createRegistryPanelFixture();
    const panelB = createRegistryPanelFixture();
    const viewerA = registry.registerPanel(panelA.panel, "/workspace/examples/a.csv");
    const viewerB = registry.registerPanel(panelB.panel, "/workspace/examples/a.csv");

    registry.markViewerFocused(viewerA);
    expect(registry.hasOpenPanelForDataset("/workspace/examples/a.csv")).toBe(true);

    registry.removeViewer(viewerA);
    expect(selectTarget(registry, "/workspace/examples/a.csv")).toBe(viewerB);

    registry.removeViewer(viewerB);
    expect(registry.hasOpenPanelForDataset("/workspace/examples/a.csv")).toBe(false);
    expect(registry.getActiveViewerId()).toBeUndefined();
  });
});
