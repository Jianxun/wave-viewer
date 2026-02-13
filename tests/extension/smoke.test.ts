import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { PROTOCOL_VERSION, createProtocolEnvelope } from "../../src/core/dataset/types";
import {
  applyDropSignalAction,
  applySidePanelSignalAction,
  createClearLayoutCommand,
  createExportFrozenBundleCommand,
  createOpenLayoutCommand,
  createSaveLayoutAsCommand,
  createSaveLayoutCommand,
  createImportSpecCommand,
  createViewerSessionRegistry,
  createNoTargetViewerWarning,
  createLoadCsvFilesCommand,
  computeLayoutWatchTransition,
  createHostStateStore,
  createLayoutExternalEditController,
  createOpenViewerCommand,
  createLayoutAutosaveController,
  createRemoveLoadedFileCommand,
  createReloadAllLoadedFilesCommand,
  writeLayoutFileAtomically,
  isCsvFile,
  LOAD_CSV_FILES_COMMAND,
  EXPORT_FROZEN_BUNDLE_COMMAND,
  CLEAR_LAYOUT_COMMAND,
  OPEN_VIEWER_COMMAND,
  OPEN_LAYOUT_COMMAND,
  REMOVE_LOADED_FILE_COMMAND,
  RELOAD_ALL_FILES_COMMAND,
  SAVE_LAYOUT_AS_COMMAND,
  SIGNAL_BROWSER_QUICK_ADD_COMMAND,
  SIGNAL_BROWSER_ADD_TO_NEW_AXIS_COMMAND,
  SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND,
  runResolvedSidePanelQuickAdd,
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
import { reduceWorkspaceState } from "../../src/webview/state/reducer";
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
  resolveViewerSessionContext?: ReturnType<typeof vi.fn>;
}): {
  deps: CommandDeps;
  panelFixture: PanelFixture;
  showError: ReturnType<typeof vi.fn>;
  logDebug: ReturnType<typeof vi.fn>;
  getCachedWorkspace: ReturnType<typeof vi.fn>;
  setCachedWorkspace: ReturnType<typeof vi.fn>;
} {
  const datasetPath = "/workspace/examples/simulations/ota.spice.csv";
  const panelFixture = overrides?.panelFixture ?? createPanelFixture();
  const showError = vi.fn();
  const logDebug = vi.fn();
  const hasActiveDocument = overrides?.hasActiveDocument ?? true;
  const store = createHostStateStore();
  if (overrides?.initialWorkspace) {
    store.setWorkspace(datasetPath, overrides.initialWorkspace);
  }
  const getCachedWorkspace = vi.fn((documentPath: string) => store.getWorkspace(documentPath));
  const setCachedWorkspace = vi.fn((documentPath: string, workspace: WorkspaceState) => {
    store.setWorkspace(documentPath, workspace);
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
          path: datasetPath,
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
    onPanelCreated: () => "viewer-1",
    getCachedWorkspace,
    setCachedWorkspace,
    getHostStateSnapshot: (documentPath) => store.getSnapshot(documentPath),
    ensureHostStateSnapshot: (documentPath, defaultXSignal) =>
      store.ensureSnapshot(documentPath, defaultXSignal),
    commitHostStateTransaction: (transaction) => store.commitTransaction(transaction),
    showError,
    logDebug,
    buildHtml: () => overrides?.buildHtml ?? "<html>shell</html>"
  };
  if (overrides?.resolveViewerSessionContext) {
    deps.resolveViewerSessionContext = overrides.resolveViewerSessionContext;
  }
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

function createReferenceOnlySpecYaml(datasetPath: string): string {
  return [
    "version: 2",
    "datasets:",
    "  - id: ds-1",
    `    path: ${datasetPath}`,
    "active_dataset: ds-1",
    "active_plot: plot-1",
    "plots:",
    "  - id: plot-1",
    "    name: Plot 1",
    "    x:",
    "      dataset: ds-1",
    "      signal: time",
    "    y:",
    "      - id: lane-main",
    "        signals: {}"
  ].join("\n");
}

function createMultiDatasetSpecYaml(primaryDatasetPath: string, secondaryDatasetPath: string): string {
  return [
    "version: 2",
    "datasets:",
    "  - id: ds-a",
    `    path: ${primaryDatasetPath}`,
    "  - id: ds-b",
    `    path: ${secondaryDatasetPath}`,
    "active_dataset: ds-a",
    "active_plot: plot-1",
    "plots:",
    "  - id: plot-1",
    "    name: Plot 1",
    "    x:",
    "      dataset: ds-a",
    "      signal: time",
    "    y:",
    "      - id: lane-main",
    "        signals:",
    "          vin:",
    "            dataset: ds-b",
    "            signal: vin"
  ].join("\n");
}

function createDatasetQualifiedReplaySpecYaml(
  primaryDatasetPath: string,
  secondaryDatasetPath: string
): string {
  return [
    "version: 2",
    "datasets:",
    "  - id: ds-a",
    `    path: ${primaryDatasetPath}`,
    "  - id: ds-b",
    `    path: ${secondaryDatasetPath}`,
    "active_dataset: ds-a",
    "active_plot: plot-1",
    "plots:",
    "  - id: plot-1",
    "    name: Plot 1",
    "    x:",
    "      dataset: ds-a",
    "      signal: time",
    "    y:",
    "      - id: lane-main",
    "        signals:",
    "          ib-trace:",
    "            dataset: ds-b",
    "            signal: ib"
  ].join("\n");
}

describe("T-002 extension shell smoke", () => {
  it("allows data/blob image sources in webview CSP for Plotly PNG export", () => {
    const template = fs.readFileSync(
      path.resolve(process.cwd(), "src/webview/index.html"),
      "utf8"
    );

    expect(template).toContain("img-src __CSP_SOURCE__ data: blob:;");
  });

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
      type: "host/viewerBindingUpdated",
      payload: {
        viewerId: "viewer-1",
        datasetPath: "/workspace/examples/simulations/ota.spice.csv"
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

  it("loads webview shell and posts init + viewer identity after ready", async () => {
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
        type: "host/viewerBindingUpdated",
        payload: {
          viewerId: "viewer-1",
          datasetPath: "/workspace/examples/simulations/ota.spice.csv"
        }
      }
    ]);
  });

  it("hydrates cached workspace traces and emits tuple payloads before stateSnapshot", async () => {
    const cachedWorkspace: WorkspaceState = {
      activePlotId: "plot-1",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          axes: [{ id: "y1" }],
          traces: [
            {
              id: "trace-1",
              signal: "vin",
              axisId: "y1",
              visible: true
            }
          ],
          nextAxisNumber: 2
        }
      ]
    };
    const { deps, panelFixture, setCachedWorkspace } = createDeps({
      initialWorkspace: cachedWorkspace
    });

    await createOpenViewerCommand(deps)();
    panelFixture.emitMessage(createProtocolEnvelope("webview/ready", { ready: true }));

    expect(panelFixture.sentMessages.map((message) => message.type)).toEqual([
      "host/init",
      "host/viewerBindingUpdated",
      "host/tupleUpsert",
      "host/stateSnapshot"
    ]);
    expect(panelFixture.sentMessages[2]).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/tupleUpsert",
      payload: {
        tuples: [
          {
            traceId: "trace-1",
            sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
            datasetPath: "/workspace/examples/simulations/ota.spice.csv",
            xName: "time",
            yName: "vin",
            x: [0, 1, 2],
            y: [1, 2, 3]
          }
        ]
      }
    });
    expect(panelFixture.sentMessages[3]).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/stateSnapshot",
      payload: {
        revision: 1,
        workspace: {
          activePlotId: "plot-1",
          plots: [
            {
              id: "plot-1",
              name: "Plot 1",
              xSignal: "time",
              axes: [{ id: "y1" }],
              traces: [
                {
                  id: "trace-1",
                  signal: "vin",
                  sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
                  axisId: "y1",
                  visible: true
                }
              ],
              nextAxisNumber: 2
            }
          ]
        },
        viewerState: {
          activePlotId: "plot-1",
          activeAxisByPlotId: {
            "plot-1": "y1"
          }
        }
      }
    });
    expect(setCachedWorkspace).toHaveBeenCalledWith("/workspace/examples/simulations/ota.spice.csv", {
      activePlotId: "plot-1",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          axes: [{ id: "y1" }],
          traces: [
            {
              id: "trace-1",
              signal: "vin",
              sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
              axisId: "y1",
              visible: true
            }
          ],
          nextAxisNumber: 2
        }
      ]
    });
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
      },
      {
        version: PROTOCOL_VERSION,
        type: "host/viewerBindingUpdated",
        payload: {
          viewerId: "viewer-1"
        }
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

  it("resolves viewer dataset context via host session resolver", async () => {
    const resolveViewerSessionContext = vi.fn(() => ({
      datasetPath: "/workspace/examples/simulations/alternate.csv",
      layoutUri: "/workspace/layouts/alternate.wave-viewer.yaml"
    }));
    const { deps, panelFixture, logDebug } = createDeps({
      hasActiveDocument: false,
      preferredDatasetPath: undefined,
      resolveViewerSessionContext
    });

    await createOpenViewerCommand(deps)();
    panelFixture.emitMessage(
      createProtocolEnvelope("webview/intent/dropSignal", {
        viewerId: "viewer-1",
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis", axisId: "y1" },
        source: "axis-row",
        requestId: "req-1"
      })
    );

    expect(resolveViewerSessionContext).toHaveBeenCalledWith("viewer-1");
    expect(logDebug).not.toHaveBeenCalledWith(
      "Ignored dropSignal because no dataset is bound to this panel.",
      expect.anything()
    );
  });

  it("ignores unknown inbound messages without posting responses", async () => {
    const { deps, panelFixture } = createDeps();

    await createOpenViewerCommand(deps)();
    panelFixture.emitMessage(createProtocolEnvelope("webview/unknown", { whatever: true }));

    expect(panelFixture.sentMessages).toEqual([]);
  });
});

describe("T-030 reference-only spec import workflow", () => {
  it("rejects import when spec dataset reference does not match active CSV", async () => {
    const showError = vi.fn();
    const showInformation = vi.fn();
    const setCachedWorkspace = vi.fn();
    const command = createImportSpecCommand({
      getActiveDocument: () => ({
        fileName: "/workspace/examples/simulations/new.csv",
        uri: { fsPath: "/workspace/examples/simulations/new.csv" }
      }),
      loadDataset: () => ({
        dataset: {
          path: "/workspace/examples/simulations/new.csv",
          rowCount: 3,
          columns: [{ name: "time", values: [0, 1, 2] }, { name: "vin", values: [1, 2, 3] }]
        },
        defaultXSignal: "time"
      }),
      setCachedWorkspace,
      showError,
      showInformation,
      showOpenDialog: async () => "/workspace/specs/replay.wave-viewer.yaml",
      readTextFile: () => createReferenceOnlySpecYaml("/workspace/examples/simulations/old.csv")
    });

    await command();

    expect(showError).toHaveBeenCalledWith(
      "Wave Viewer reference-only spec points to '/workspace/examples/simulations/old.csv', but the active CSV is '/workspace/examples/simulations/new.csv'. Open the referenced CSV or re-export the spec from the current file."
    );
    expect(showInformation).not.toHaveBeenCalled();
    expect(setCachedWorkspace).not.toHaveBeenCalled();
  });

  it("imports reference-only spec when dataset reference matches active CSV", async () => {
    const showError = vi.fn();
    const showInformation = vi.fn();
    const setCachedWorkspace = vi.fn();
    const command = createImportSpecCommand({
      getActiveDocument: () => ({
        fileName: "/workspace/examples/simulations/ota.spice.csv",
        uri: { fsPath: "/workspace/examples/simulations/ota.spice.csv" }
      }),
      loadDataset: () => ({
        dataset: {
          path: "/workspace/examples/simulations/ota.spice.csv",
          rowCount: 3,
          columns: [{ name: "time", values: [0, 1, 2] }, { name: "vin", values: [1, 2, 3] }]
        },
        defaultXSignal: "time"
      }),
      setCachedWorkspace,
      showError,
      showInformation,
      showOpenDialog: async () => "/workspace/specs/replay.wave-viewer.yaml",
      readTextFile: () =>
        createReferenceOnlySpecYaml("/workspace/examples/simulations/ota.spice.csv")
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(setCachedWorkspace).toHaveBeenCalledTimes(1);
    expect(showInformation).toHaveBeenCalledWith(
      "Wave Viewer spec imported from /workspace/specs/replay.wave-viewer.yaml"
    );
  });
});

describe("T-046 explicit layout commands", () => {
  it("exports explicit layout command ids", () => {
    expect(OPEN_LAYOUT_COMMAND).toBe("waveViewer.openLayout");
    expect(SAVE_LAYOUT_AS_COMMAND).toBe("waveViewer.saveLayoutAs");
    expect(CLEAR_LAYOUT_COMMAND).toBe("waveViewer.clearLayout");
  });

  it("clears the bound layout workspace through a host transaction", async () => {
    const store = createHostStateStore();
    const panelFixture = createPanelFixture();
    const showError = vi.fn();
    const showWarning = vi.fn(async () => "Clear Layout");
    const datasetPath = "/workspace/examples/simulations/ota.spice.csv";

    store.setWorkspace(datasetPath, {
      activePlotId: "plot-2",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          axes: [{ id: "y1" }, { id: "y2" }],
          traces: [{ id: "trace-1", signal: "vin", axisId: "y2", visible: true }],
          nextAxisNumber: 3
        },
        {
          id: "plot-2",
          name: "Scope B",
          xSignal: "frequency",
          axes: [{ id: "y1" }],
          traces: [{ id: "trace-2", signal: "vout", axisId: "y1", visible: true }],
          nextAxisNumber: 2
        }
      ]
    });

    const command = createClearLayoutCommand({
      getActiveViewerId: () => "viewer-1",
      resolveViewerSessionContext: () => ({
        datasetPath,
        layoutUri: `${datasetPath}.wave-viewer.yaml`
      }),
      loadDataset: () => ({
        dataset: {
          path: datasetPath,
          rowCount: 3,
          columns: [
            { name: "time", values: [0, 1, 2] },
            { name: "frequency", values: [1, 2, 3] },
            { name: "vin", values: [1, 2, 3] }
          ]
        },
        defaultXSignal: "time"
      }),
      commitHostStateTransaction: (transaction) => store.commitTransaction(transaction),
      getPanelForViewer: () => panelFixture.panel,
      showWarning,
      showError
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledTimes(1);
    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/statePatch",
        payload: {
          revision: 1,
          workspace: {
            activePlotId: "plot-1",
            plots: [
              {
                id: "plot-1",
                name: "Plot 1",
                xSignal: "frequency",
                axes: [{ id: "y1" }],
                traces: [],
                nextAxisNumber: 2
              }
            ]
          },
          viewerState: {
            activePlotId: "plot-1",
            activeAxisByPlotId: {
              "plot-1": "y1"
            }
          },
          reason: "clearLayout:command"
        }
      }
    ]);
  });

  it("opens a selected layout into the active viewer session", async () => {
    const showError = vi.fn();
    const showInformation = vi.fn();
    const bindViewerToLayout = vi.fn();
    const recordLayoutAxisLaneIdMap = vi.fn();
    const panelFixture = createPanelFixture();
    const setCachedWorkspace = vi.fn((_documentPath: string, workspace: WorkspaceState) => ({
      workspace,
      revision: 3,
      viewerState: {
        activePlotId: workspace.activePlotId,
        activeAxisByPlotId: { "plot-1": "y1" as const }
      }
    }));
    const command = createOpenLayoutCommand({
      getActiveViewerId: () => "viewer-1",
      showOpenDialog: async () => "/workspace/layouts/lab.wave-viewer.yaml",
      readTextFile: () => createReferenceOnlySpecYaml("/workspace/examples/simulations/ota.spice.csv"),
      loadDataset: () => ({
        dataset: {
          path: "/workspace/examples/simulations/ota.spice.csv",
          rowCount: 3,
          columns: [{ name: "time", values: [0, 1, 2] }, { name: "vin", values: [1, 2, 3] }]
        },
        defaultXSignal: "time"
      }),
      setCachedWorkspace,
      bindViewerToLayout,
      recordLayoutAxisLaneIdMap,
      getPanelForViewer: () => panelFixture.panel,
      showError,
      showInformation
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(setCachedWorkspace).toHaveBeenCalledWith("/workspace/examples/simulations/ota.spice.csv", {
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
    });
    expect(bindViewerToLayout).toHaveBeenCalledWith(
      "viewer-1",
      "/workspace/layouts/lab.wave-viewer.yaml",
      "/workspace/examples/simulations/ota.spice.csv"
    );
    expect(recordLayoutAxisLaneIdMap).toHaveBeenCalledWith(
      "/workspace/layouts/lab.wave-viewer.yaml",
      { "plot-1": { y1: "lane-main" } }
    );
    expect(panelFixture.sentMessages.map((message) => message.type)).toEqual([
      "host/viewerBindingUpdated",
      "host/statePatch"
    ]);
    expect(panelFixture.sentMessages[0]).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/viewerBindingUpdated",
      payload: {
        viewerId: "viewer-1",
        datasetPath: "/workspace/examples/simulations/ota.spice.csv"
      }
    });
    expect(panelFixture.sentMessages[1]).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/statePatch",
      payload: {
        revision: 3,
        workspace: {
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
        viewerState: {
          activePlotId: "plot-1",
          activeAxisByPlotId: { "plot-1": "y1" as const }
        },
        reason: "openLayout:command"
      }
    });
    expect(showInformation).toHaveBeenCalledWith(
      "Wave Viewer layout opened from /workspace/layouts/lab.wave-viewer.yaml"
    );
  });

  it("resolves relative dataset paths against the opened layout location", async () => {
    const showError = vi.fn();
    const showInformation = vi.fn();
    const loadDataset = vi.fn(() => ({
      dataset: {
        path: "/workspace/examples/simulations/ota.spice.csv",
        rowCount: 3,
        columns: [{ name: "time", values: [0, 1, 2] }, { name: "vin", values: [1, 2, 3] }]
      },
      defaultXSignal: "time"
    }));
    const bindViewerToLayout = vi.fn();
    const command = createOpenLayoutCommand({
      getActiveViewerId: () => "viewer-1",
      showOpenDialog: async () => "/workspace/layouts/lab.wave-viewer.yaml",
      readTextFile: () =>
        createReferenceOnlySpecYaml("../examples/simulations/ota.spice.csv"),
      loadDataset,
      setCachedWorkspace: vi.fn((_documentPath: string, workspace: WorkspaceState) => ({
        workspace,
        revision: 1,
        viewerState: {
          activePlotId: workspace.activePlotId,
          activeAxisByPlotId: { "plot-1": "y1" as const }
        }
      })),
      bindViewerToLayout,
      getPanelForViewer: vi.fn(),
      showError,
      showInformation
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(loadDataset).toHaveBeenCalledWith("/workspace/examples/simulations/ota.spice.csv");
    expect(bindViewerToLayout).toHaveBeenCalledWith(
      "viewer-1",
      "/workspace/layouts/lab.wave-viewer.yaml",
      "/workspace/examples/simulations/ota.spice.csv"
    );
    expect(showInformation).toHaveBeenCalledWith(
      "Wave Viewer layout opened from /workspace/layouts/lab.wave-viewer.yaml"
    );
  });

  it("rejects malformed layout YAML on open with import validator errors", async () => {
    const showError = vi.fn();
    const command = createOpenLayoutCommand({
      getActiveViewerId: () => "viewer-1",
      showOpenDialog: async () => "/workspace/layouts/lab.wave-viewer.yaml",
      readTextFile: () => "version: nope",
      loadDataset: () => ({
        dataset: {
          path: "/workspace/examples/simulations/ota.spice.csv",
          rowCount: 3,
          columns: [{ name: "time", values: [0, 1, 2] }, { name: "vin", values: [1, 2, 3] }]
        },
        defaultXSignal: "time"
      }),
      setCachedWorkspace: vi.fn((_documentPath: string, workspace: WorkspaceState) => ({
        workspace,
        revision: 0,
        viewerState: {
          activePlotId: workspace.activePlotId,
          activeAxisByPlotId: { "plot-1": "y1" as const }
        }
      })),
      bindViewerToLayout: vi.fn(),
      getPanelForViewer: vi.fn(),
      showError,
      showInformation: vi.fn()
    });

    await command();

    expect(showError).toHaveBeenCalledWith(
      "Unsupported plot spec version: nope. Supported version is 2."
    );
  });

  it("auto-opens and binds a viewer when no viewer is focused for open layout", async () => {
    const showError = vi.fn();
    const showInformation = vi.fn();
    const panelFixture = createPanelFixture();
    const bindViewerToLayout = vi.fn();
    const registerLoadedDataset = vi.fn();
    const command = createOpenLayoutCommand({
      getActiveViewerId: () => undefined,
      showOpenDialog: async () => "/workspace/layouts/lab.wave-viewer.yaml",
      readTextFile: () =>
        createMultiDatasetSpecYaml(
          "/workspace/examples/simulations/ota.spice.csv",
          "/workspace/examples/simulations/alt.csv"
        ),
      loadDataset: (documentPath) => ({
        dataset: {
          path: documentPath,
          rowCount: 3,
          columns: [{ name: "time", values: [0, 1, 2] }, { name: "vin", values: [1, 2, 3] }]
        },
        defaultXSignal: "time"
      }),
      setCachedWorkspace: vi.fn((_documentPath: string, workspace: WorkspaceState) => ({
        workspace,
        revision: 0,
        viewerState: {
          activePlotId: workspace.activePlotId,
          activeAxisByPlotId: { "plot-1": "y1" as const }
        }
      })),
      bindViewerToLayout,
      getPanelForViewer: () => panelFixture.panel,
      ensureViewerForDataset: async () => "viewer-9",
      registerLoadedDataset,
      showError,
      showInformation
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(bindViewerToLayout).toHaveBeenCalledWith(
      "viewer-9",
      "/workspace/layouts/lab.wave-viewer.yaml",
      "/workspace/examples/simulations/ota.spice.csv"
    );
    expect(registerLoadedDataset).toHaveBeenCalledTimes(2);
    expect(registerLoadedDataset).toHaveBeenNthCalledWith(1, "/workspace/examples/simulations/ota.spice.csv", {
      dataset: {
        path: "/workspace/examples/simulations/ota.spice.csv",
        rowCount: 3,
        columns: [{ name: "time", values: [0, 1, 2] }, { name: "vin", values: [1, 2, 3] }]
      },
      defaultXSignal: "time"
    });
    expect(registerLoadedDataset).toHaveBeenNthCalledWith(2, "/workspace/examples/simulations/alt.csv", {
      dataset: {
        path: "/workspace/examples/simulations/alt.csv",
        rowCount: 3,
        columns: [{ name: "time", values: [0, 1, 2] }, { name: "vin", values: [1, 2, 3] }]
      },
      defaultXSignal: "time"
    });
    expect(showInformation).toHaveBeenCalledWith(
      "Wave Viewer layout opened from /workspace/layouts/lab.wave-viewer.yaml"
    );
  });

  it("replays dataset-qualified tuples when opening a multi-dataset layout", async () => {
    const showError = vi.fn();
    const showInformation = vi.fn();
    const panelFixture = createPanelFixture();
    const command = createOpenLayoutCommand({
      getActiveViewerId: () => "viewer-7",
      showOpenDialog: async () => "/workspace/layouts/lab.wave-viewer.yaml",
      readTextFile: () =>
        createDatasetQualifiedReplaySpecYaml(
          "/workspace/examples/run-a.csv",
          "/workspace/examples/run-b.csv"
        ),
      loadDataset: (documentPath) => {
        if (documentPath === "/workspace/examples/run-b.csv") {
          return {
            dataset: {
              path: documentPath,
              rowCount: 3,
              columns: [
                { name: "frequency", values: [10, 100, 1000] },
                { name: "ib", values: [0.3, 0.2, 0.1] }
              ]
            },
            defaultXSignal: "frequency"
          };
        }
        return {
          dataset: {
            path: documentPath,
            rowCount: 3,
            columns: [
              { name: "time", values: [0, 1, 2] },
              { name: "vin", values: [1, 2, 3] }
            ]
          },
          defaultXSignal: "time"
        };
      },
      setCachedWorkspace: vi.fn((_documentPath: string, workspace: WorkspaceState) => ({
        workspace,
        revision: 0,
        viewerState: {
          activePlotId: workspace.activePlotId,
          activeAxisByPlotId: { "plot-1": "y1" as const }
        }
      })),
      bindViewerToLayout: vi.fn(),
      getPanelForViewer: () => panelFixture.panel,
      showError,
      showInformation
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    const tupleMessage = panelFixture.sentMessages.find(
      (message) => message.type === "host/tupleUpsert"
    );
    expect(tupleMessage).toBeDefined();
    expect(tupleMessage?.payload.tuples[0]).toMatchObject({
      sourceId: "/workspace/examples/run-b.csv::ib",
      datasetPath: "/workspace/examples/run-b.csv",
      xName: "frequency",
      x: [10, 100, 1000],
      yName: "ib",
      y: [0.3, 0.2, 0.1]
    });
    expect(showInformation).toHaveBeenCalledWith(
      "Wave Viewer layout opened from /workspace/layouts/lab.wave-viewer.yaml"
    );
  });

  it("saves active viewer workspace to its bound layout path", async () => {
    const showError = vi.fn();
    const showInformation = vi.fn();
    const writeTextFile = vi.fn();
    const command = createSaveLayoutCommand({
      getActiveViewerId: () => "viewer-1",
      resolveViewerSessionContext: () => ({
        datasetPath: "/workspace/examples/simulations/ota.spice.csv",
        layoutUri: "/workspace/layouts/lab.wave-viewer.yaml"
      }),
      loadDataset: () => ({
        dataset: {
          path: "/workspace/examples/simulations/ota.spice.csv",
          rowCount: 3,
          columns: [{ name: "time", values: [0, 1, 2] }, { name: "vin", values: [1, 2, 3] }]
        },
        defaultXSignal: "time"
      }),
      getCachedWorkspace: () => createWorkspaceFixture(),
      writeTextFile,
      showError,
      showInformation
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(writeTextFile).toHaveBeenCalledWith(
      "/workspace/layouts/lab.wave-viewer.yaml",
      expect.stringContaining("dataset:")
    );
    expect(writeTextFile).toHaveBeenCalledWith(
      "/workspace/layouts/lab.wave-viewer.yaml",
      expect.stringContaining("- id: lane-1")
    );
    expect(showInformation).toHaveBeenCalledWith(
      "Wave Viewer layout saved to /workspace/layouts/lab.wave-viewer.yaml"
    );
  });

  it("preserves user-facing lane ids when saving a bound layout", async () => {
    const showError = vi.fn();
    const showInformation = vi.fn();
    const writeTextFile = vi.fn();
    const command = createSaveLayoutCommand({
      getActiveViewerId: () => "viewer-1",
      resolveViewerSessionContext: () => ({
        datasetPath: "/workspace/examples/simulations/ota.spice.csv",
        layoutUri: "/workspace/layouts/lab.wave-viewer.yaml"
      }),
      loadDataset: () => ({
        dataset: {
          path: "/workspace/examples/simulations/ota.spice.csv",
          rowCount: 3,
          columns: [{ name: "time", values: [0, 1, 2] }, { name: "vin", values: [1, 2, 3] }]
        },
        defaultXSignal: "time"
      }),
      getCachedWorkspace: () => createWorkspaceFixture(),
      resolveLayoutAxisLaneIdMap: () => ({ "plot-1": { y1: "lane-io" } }),
      writeTextFile,
      showError,
      showInformation
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(writeTextFile).toHaveBeenCalledWith(
      "/workspace/layouts/lab.wave-viewer.yaml",
      expect.stringContaining("- id: lane-io")
    );
  });

  it("saves colocated layouts with relative dataset reference", async () => {
    const showError = vi.fn();
    const showInformation = vi.fn();
    const writeTextFile = vi.fn();
    const command = createSaveLayoutCommand({
      getActiveViewerId: () => "viewer-1",
      resolveViewerSessionContext: () => ({
        datasetPath: "/workspace/layouts/ota.spice.csv",
        layoutUri: "/workspace/layouts/lab.wave-viewer.yaml"
      }),
      loadDataset: () => ({
        dataset: {
          path: "/workspace/layouts/ota.spice.csv",
          rowCount: 3,
          columns: [{ name: "time", values: [0, 1, 2] }, { name: "vin", values: [1, 2, 3] }]
        },
        defaultXSignal: "time"
      }),
      getCachedWorkspace: () => createWorkspaceFixture(),
      writeTextFile,
      showError,
      showInformation
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(writeTextFile).toHaveBeenCalledWith(
      "/workspace/layouts/lab.wave-viewer.yaml",
      expect.stringContaining("path: ./ota.spice.csv")
    );
  });

  it("save layout as updates viewer layout binding and writes to selected path", async () => {
    const showError = vi.fn();
    const showInformation = vi.fn();
    const writeTextFile = vi.fn();
    const bindViewerToLayout = vi.fn();
    const command = createSaveLayoutAsCommand({
      getActiveViewerId: () => "viewer-1",
      resolveViewerSessionContext: () => ({
        datasetPath: "/workspace/examples/simulations/ota.spice.csv",
        layoutUri: "/workspace/layouts/lab.wave-viewer.yaml"
      }),
      loadDataset: () => ({
        dataset: {
          path: "/workspace/examples/simulations/ota.spice.csv",
          rowCount: 3,
          columns: [{ name: "time", values: [0, 1, 2] }, { name: "vin", values: [1, 2, 3] }]
        },
        defaultXSignal: "time"
      }),
      getCachedWorkspace: () => createWorkspaceFixture(),
      showSaveDialog: async () => "/workspace/layouts/lab-alt.wave-viewer.yaml",
      writeTextFile,
      bindViewerToLayout,
      showError,
      showInformation
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(writeTextFile).toHaveBeenCalledWith(
      "/workspace/layouts/lab-alt.wave-viewer.yaml",
      expect.stringContaining("dataset:")
    );
    expect(bindViewerToLayout).toHaveBeenCalledWith(
      "viewer-1",
      "/workspace/layouts/lab-alt.wave-viewer.yaml",
      "/workspace/examples/simulations/ota.spice.csv"
    );
    expect(showInformation).toHaveBeenCalledWith(
      "Wave Viewer layout saved to /workspace/layouts/lab-alt.wave-viewer.yaml"
    );
  });
});

describe("T-052 frozen bundle export", () => {
  it("exports frozen bundle command id", () => {
    expect(EXPORT_FROZEN_BUNDLE_COMMAND).toBe("waveViewer.exportFrozenBundle");
  });

  it("exports deterministic frozen csv + layout artifacts", async () => {
    const showError = vi.fn();
    const showInformation = vi.fn();
    const writeTextFile = vi.fn();
    const command = createExportFrozenBundleCommand({
      getActiveViewerId: () => "viewer-1",
      resolveViewerSessionContext: () => ({
        datasetPath: "/workspace/examples/simulations/ota.spice.csv",
        layoutUri: "/workspace/layouts/lab.wave-viewer.yaml"
      }),
      loadDataset: () => ({
        dataset: {
          path: "/workspace/examples/simulations/ota.spice.csv",
          rowCount: 3,
          columns: [
            { name: "time", values: [0, 1, 2] },
            { name: "vin", values: [1, 2, 3] },
            { name: "vout", values: [9, 8, 7] },
            { name: "unused", values: [4, 5, 6] }
          ]
        },
        defaultXSignal: "time"
      }),
      getCachedWorkspace: () => ({
        activePlotId: "plot-2",
        plots: [
          {
            id: "plot-1",
            name: "Plot 1",
            xSignal: "vout",
            axes: [{ id: "y1" }],
            traces: [{ id: "trace-1", signal: "vin", axisId: "y1", visible: true }],
            nextAxisNumber: 2
          },
          {
            id: "plot-2",
            name: "Plot 2",
            xSignal: "time",
            axes: [{ id: "y1" }],
            traces: [{ id: "trace-2", signal: "vout", axisId: "y1", visible: true }],
            nextAxisNumber: 2
          }
        ]
      }),
      resolveLayoutAxisLaneIdMap: () => ({
        "plot-1": { y1: "lane-vin" },
        "plot-2": { y1: "lane-vout" }
      }),
      showSaveDialog: async () => "/workspace/exports/snapshot.frozen.wave-viewer.yaml",
      writeTextFile,
      showError,
      showInformation
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(writeTextFile).toHaveBeenCalledTimes(2);
    expect(writeTextFile).toHaveBeenNthCalledWith(
      1,
      "/workspace/exports/snapshot.dataset-1.frozen.csv",
      "time,vin,vout\n0,1,9\n1,2,8\n2,3,7\n"
    );
    expect(writeTextFile).toHaveBeenNthCalledWith(
      2,
      "/workspace/exports/snapshot.frozen.wave-viewer.yaml",
      expect.stringContaining("path: ./snapshot.dataset-1.frozen.csv")
    );
    expect(showInformation).toHaveBeenCalledWith(
      "Wave Viewer frozen bundle exported to /workspace/exports/snapshot.frozen.wave-viewer.yaml and dataset CSVs: /workspace/exports/snapshot.dataset-1.frozen.csv"
    );
  });

  it("does not duplicate frozen suffix when save target uses .yml", async () => {
    const showError = vi.fn();
    const showInformation = vi.fn();
    const writeTextFile = vi.fn();
    const command = createExportFrozenBundleCommand({
      getActiveViewerId: () => "viewer-1",
      resolveViewerSessionContext: () => ({
        datasetPath: "/workspace/examples/simulations/ota.spice.csv",
        layoutUri: "/workspace/layouts/lab.wave-viewer.yaml"
      }),
      loadDataset: () => ({
        dataset: {
          path: "/workspace/examples/simulations/ota.spice.csv",
          rowCount: 1,
          columns: [{ name: "time", values: [0] }]
        },
        defaultXSignal: "time"
      }),
      getCachedWorkspace: () => ({
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
      }),
      showSaveDialog: async () => "/workspace/exports/snapshot.frozen.wave-viewer.yml",
      writeTextFile,
      showError,
      showInformation
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(writeTextFile).toHaveBeenNthCalledWith(
      1,
      "/workspace/exports/snapshot.dataset-1.frozen.csv",
      "time\n0\n"
    );
    expect(writeTextFile).toHaveBeenNthCalledWith(
      2,
      "/workspace/exports/snapshot.frozen.wave-viewer.yml",
      expect.stringContaining("path: ./snapshot.dataset-1.frozen.csv")
    );
    expect(showInformation).toHaveBeenCalledWith(
      "Wave Viewer frozen bundle exported to /workspace/exports/snapshot.frozen.wave-viewer.yml and dataset CSVs: /workspace/exports/snapshot.dataset-1.frozen.csv"
    );
  });

  it("exports one frozen CSV per referenced dataset id and rewrites layout dataset paths", async () => {
    const showError = vi.fn();
    const showInformation = vi.fn();
    const writeTextFile = vi.fn();
    const loadDataset = vi.fn((documentPath: string) => {
      if (documentPath === "/workspace/examples/run-a.csv") {
        return {
          dataset: {
            path: documentPath,
            rowCount: 2,
            columns: [
              { name: "time_a", values: [0, 1] },
              { name: "vin_a", values: [10, 11] },
              { name: "unused_a", values: [90, 91] }
            ]
          },
          defaultXSignal: "time_a"
        };
      }
      if (documentPath === "/workspace/examples/run-b.csv") {
        return {
          dataset: {
            path: documentPath,
            rowCount: 2,
            columns: [
              { name: "time_b", values: [0, 1] },
              { name: "vin_b", values: [20, 21] },
              { name: "unused_b", values: [30, 31] }
            ]
          },
          defaultXSignal: "time_b"
        };
      }
      throw new Error(`Unknown dataset path: ${documentPath}`);
    });

    const command = createExportFrozenBundleCommand({
      getActiveViewerId: () => "viewer-1",
      resolveViewerSessionContext: () => ({
        datasetPath: "/workspace/examples/run-a.csv",
        layoutUri: "/workspace/layouts/lab.wave-viewer.yaml"
      }),
      loadDataset,
      getCachedWorkspace: () => ({
        activePlotId: "plot-1",
        plots: [
          {
            id: "plot-1",
            name: "Plot 1",
            xSignal: "time_b",
            axes: [{ id: "y1" }],
            traces: [{ id: "trace-b", signal: "vin_b", sourceId: "/workspace/examples/run-b.csv::vin_b", axisId: "y1", visible: true }],
            nextAxisNumber: 2
          },
          {
            id: "plot-2",
            name: "Plot 2",
            xSignal: "time_a",
            axes: [{ id: "y1" }],
            traces: [{ id: "trace-a", signal: "vin_a", sourceId: "/workspace/examples/run-a.csv::vin_a", axisId: "y1", visible: true }],
            nextAxisNumber: 2
          }
        ]
      }),
      resolveLayoutXDatasetPathMap: () => ({
        "plot-1": "/workspace/examples/run-b.csv",
        "plot-2": "/workspace/examples/run-a.csv"
      }),
      showSaveDialog: async () => "/workspace/exports/snapshot.frozen.wave-viewer.yaml",
      writeTextFile,
      showError,
      showInformation
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(writeTextFile).toHaveBeenCalledTimes(3);
    expect(writeTextFile).toHaveBeenNthCalledWith(
      1,
      "/workspace/exports/snapshot.dataset-1.frozen.csv",
      "time_a,vin_a\n0,10\n1,11\n"
    );
    expect(writeTextFile).toHaveBeenNthCalledWith(
      2,
      "/workspace/exports/snapshot.dataset-2.frozen.csv",
      "time_b,vin_b\n0,20\n1,21\n"
    );
    expect(writeTextFile).toHaveBeenNthCalledWith(
      3,
      "/workspace/exports/snapshot.frozen.wave-viewer.yaml",
      expect.stringContaining("path: ./snapshot.dataset-2.frozen.csv")
    );
    expect(writeTextFile).toHaveBeenNthCalledWith(
      3,
      "/workspace/exports/snapshot.frozen.wave-viewer.yaml",
      expect.stringContaining("path: ./snapshot.dataset-1.frozen.csv")
    );
    expect(showInformation).toHaveBeenCalledWith(
      "Wave Viewer frozen bundle exported to /workspace/exports/snapshot.frozen.wave-viewer.yaml and dataset CSVs: /workspace/exports/snapshot.dataset-1.frozen.csv, /workspace/exports/snapshot.dataset-2.frozen.csv"
    );
  });

  it("fails export when workspace references missing signals", async () => {
    const showError = vi.fn();
    const writeTextFile = vi.fn();
    const command = createExportFrozenBundleCommand({
      getActiveViewerId: () => "viewer-1",
      resolveViewerSessionContext: () => ({
        datasetPath: "/workspace/examples/simulations/ota.spice.csv",
        layoutUri: "/workspace/layouts/lab.wave-viewer.yaml"
      }),
      loadDataset: () => ({
        dataset: {
          path: "/workspace/examples/simulations/ota.spice.csv",
          rowCount: 3,
          columns: [{ name: "time", values: [0, 1, 2] }]
        },
        defaultXSignal: "time"
      }),
      getCachedWorkspace: () => ({
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
      }),
      showSaveDialog: async () => "/workspace/exports/snapshot.frozen.wave-viewer.yaml",
      writeTextFile,
      showError,
      showInformation: vi.fn()
    });

    await command();

    expect(showError).toHaveBeenCalledWith(
      "Frozen export failed: workspace references missing dataset signal(s): dataset-1: vin."
    );
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("fails export when a generated frozen CSV would overwrite an active interactive dataset", async () => {
    const showError = vi.fn();
    const writeTextFile = vi.fn();
    const command = createExportFrozenBundleCommand({
      getActiveViewerId: () => "viewer-1",
      resolveViewerSessionContext: () => ({
        datasetPath: "/workspace/exports/snapshot.dataset-1.frozen.csv",
        layoutUri: "/workspace/layouts/lab.wave-viewer.yaml"
      }),
      loadDataset: () => ({
        dataset: {
          path: "/workspace/exports/snapshot.dataset-1.frozen.csv",
          rowCount: 1,
          columns: [{ name: "time", values: [0] }]
        },
        defaultXSignal: "time"
      }),
      getCachedWorkspace: () => ({
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
      }),
      showSaveDialog: async () => "/workspace/exports/snapshot.frozen.wave-viewer.yaml",
      writeTextFile,
      showError,
      showInformation: vi.fn()
    });

    await command();

    expect(showError).toHaveBeenCalledWith(
      "Frozen export failed: target CSV path cannot overwrite an active interactive CSV."
    );
    expect(writeTextFile).not.toHaveBeenCalled();
  });
});

describe("T-047 layout autosave persistence", () => {
  it("debounces autosave writes and persists the latest workspace revision", () => {
    vi.useFakeTimers();
    try {
      const persistLayout = vi.fn(() => ({
        layoutUri: "/workspace/layouts/lab.wave-viewer.yaml",
        tempUri: "/workspace/layouts/lab.wave-viewer.yaml.tmp-1",
        nonce: "nonce-1",
        revision: 0,
        writtenAtMs: Date.now(),
        mtimeMs: Date.now(),
        sizeBytes: 128,
        contentHash: "hash"
      }));
      const autosave = createLayoutAutosaveController({
        debounceMs: 100,
        resolveLayoutBinding: () => ({
          layoutUri: "/workspace/layouts/lab.wave-viewer.yaml"
        }),
        persistLayout
      });

      const workspaceOne = createWorkspaceFixture();
      const workspaceTwo = reduceWorkspaceState(workspaceOne, {
        type: "plot/rename",
        payload: { plotId: "plot-1", name: "Renamed Plot" }
      });

      autosave.schedule({
        datasetPath: "/workspace/examples/simulations/ota.spice.csv",
        workspace: workspaceOne,
        revision: 1
      });
      autosave.schedule({
        datasetPath: "/workspace/examples/simulations/ota.spice.csv",
        workspace: workspaceTwo,
        revision: 2
      });

      vi.advanceTimersByTime(99);
      expect(persistLayout).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(persistLayout).toHaveBeenCalledTimes(1);
      expect(persistLayout).toHaveBeenCalledWith({
        layoutUri: "/workspace/layouts/lab.wave-viewer.yaml",
        datasetPath: "/workspace/examples/simulations/ota.spice.csv",
        workspace: workspaceTwo,
        revision: 2
      });
      expect(
        autosave.getLastSelfWriteMetadata("/workspace/layouts/lab.wave-viewer.yaml")?.revision
      ).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes layout files atomically through temp-then-rename", () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-layout-atomic-"));
    const layoutPath = path.join(tempDir, "lab.wave-viewer.yaml");

    try {
      const metadata = writeLayoutFileAtomically(layoutPath, "version: 2");

      expect(fs.existsSync(layoutPath)).toBe(true);
      expect(fs.readFileSync(layoutPath, "utf8")).toBe("version: 2\n");
      expect(metadata.layoutUri).toBe(layoutPath);
      expect(metadata.tempUri).toContain(`${layoutPath}.tmp-`);
      expect(metadata.sizeBytes).toBeGreaterThan(0);
      expect(metadata.contentHash.length).toBeGreaterThan(0);
      const siblingNames = fs.readdirSync(tempDir);
      expect(siblingNames).toEqual(["lab.wave-viewer.yaml"]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("T-048 external layout edit reloads", () => {
  it("treats idempotent rebinds as no-op for layout watch refs", () => {
    expect(
      computeLayoutWatchTransition(
        "/workspace/layouts/lab.wave-viewer.yaml",
        "/workspace/layouts/lab.wave-viewer.yaml"
      )
    ).toEqual({ shouldWatchNext: false });
  });

  it("rebinds across layouts by unwatching old and watching new", () => {
    expect(
      computeLayoutWatchTransition(
        "/workspace/layouts/a.wave-viewer.yaml",
        "/workspace/layouts/b.wave-viewer.yaml"
      )
    ).toEqual({
      layoutUriToUnwatch: "/workspace/layouts/a.wave-viewer.yaml",
      shouldWatchNext: true
    });
  });

  it("drops watch when viewer loses layout binding", () => {
    expect(
      computeLayoutWatchTransition("/workspace/layouts/a.wave-viewer.yaml", undefined)
    ).toEqual({
      layoutUriToUnwatch: "/workspace/layouts/a.wave-viewer.yaml",
      shouldWatchNext: false
    });
  });

  it("reloads host state from external layout edits and broadcasts one patch per content hash", () => {
    const panelFixture = createPanelFixture();
    const readTextFile = vi.fn(() =>
      createReferenceOnlySpecYaml("/workspace/examples/simulations/ota.spice.csv")
    );
    const loadDataset = vi.fn(() => createLoadedDatasetFixture());
    const applyImportedWorkspace = vi.fn((datasetPath: string, workspace: WorkspaceState) => ({
      workspace,
      revision: 7,
      viewerState: {
        activePlotId: workspace.activePlotId,
        activeAxisByPlotId: { "plot-1": "y1" as const }
      },
      datasetPath
    }));
    const showError = vi.fn();
    let watchedHandler: (() => void) | undefined;
    const controller = createLayoutExternalEditController({
      debounceMs: 0,
      watchLayout: (_layoutUri, onChange) => {
        watchedHandler = onChange;
        return {
          dispose: () => {
            watchedHandler = undefined;
          }
        };
      },
      readTextFile,
      readFileStats: () => ({ mtimeMs: 1200, sizeBytes: 512 }),
      resolveBindingsForLayout: () => [
        {
          viewerId: "viewer-1",
          datasetPath: "/workspace/examples/simulations/ota.spice.csv",
          panel: panelFixture.panel
        }
      ],
      loadDataset,
      applyImportedWorkspace,
      getLastSelfWriteMetadata: () => undefined,
      showError
    });
    controller.watchLayout("/workspace/layouts/lab.wave-viewer.yaml");

    watchedHandler?.();
    watchedHandler?.();

    expect(showError).not.toHaveBeenCalled();
    expect(loadDataset).toHaveBeenCalledTimes(1);
    expect(applyImportedWorkspace).toHaveBeenCalledTimes(1);
    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/statePatch",
        payload: {
          revision: 7,
          workspace: {
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
          viewerState: {
            activePlotId: "plot-1",
            activeAxisByPlotId: { "plot-1": "y1" as const }
          },
          reason: "layoutExternalEdit:file-watch"
        }
      }
    ]);

    controller.dispose();
  });

  it("rehydrates tuples when external layout edits keep traces but change axis assignment", () => {
    const panelFixture = createPanelFixture();
    const readTextFile = vi.fn(() =>
      [
        "version: 2",
        "datasets:",
        "  - id: ds-1",
        "    path: /workspace/examples/simulations/ota.spice.csv",
        "active_dataset: ds-1",
        "active_plot: plot-1",
        "plots:",
        "  - id: plot-1",
        "    name: Plot 1",
        "    x:",
        "      dataset: ds-1",
        "      signal: time",
        "    y:",
        "      - id: lane-main",
        "        signals: {}",
        "      - id: lane-aux",
        "        signals:",
        "          trace-1:",
        "            dataset: ds-1",
        "            signal: vin"
      ].join("\n")
    );
    const loadDataset = vi.fn(() => createLoadedDatasetFixture());
    const applyImportedWorkspace = vi.fn((datasetPath: string, workspace: WorkspaceState) => ({
      workspace,
      revision: 8,
      viewerState: {
        activePlotId: workspace.activePlotId,
        activeAxisByPlotId: { "plot-1": "y1" as const }
      },
      datasetPath
    }));
    let watchedHandler: (() => void) | undefined;
    const controller = createLayoutExternalEditController({
      debounceMs: 0,
      watchLayout: (_layoutUri, onChange) => {
        watchedHandler = onChange;
        return { dispose: () => undefined };
      },
      readTextFile,
      readFileStats: () => ({ mtimeMs: 1200, sizeBytes: 1024 }),
      resolveBindingsForLayout: () => [
        {
          viewerId: "viewer-1",
          datasetPath: "/workspace/examples/simulations/ota.spice.csv",
          panel: panelFixture.panel
        }
      ],
      loadDataset,
      applyImportedWorkspace,
      getLastSelfWriteMetadata: () => undefined,
      showError: vi.fn()
    });
    controller.watchLayout("/workspace/layouts/lab.wave-viewer.yaml");

    watchedHandler?.();

    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/tupleUpsert",
        payload: {
          tuples: [
            {
              traceId: "trace-1",
              sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
              datasetPath: "/workspace/examples/simulations/ota.spice.csv",
              xName: "time",
              yName: "vin",
              x: [0, 1, 2],
              y: [1, 2, 3]
            }
          ]
        }
      },
      {
        version: PROTOCOL_VERSION,
        type: "host/statePatch",
        payload: {
          revision: 8,
          workspace: {
            activePlotId: "plot-1",
            plots: [
              {
                id: "plot-1",
                name: "Plot 1",
                xSignal: "time",
                axes: [{ id: "y1" }, { id: "y2" }],
                traces: [
                  {
                    id: "trace-1",
                    signal: "vin",
                    axisId: "y2",
                    visible: true,
                    sourceId: "/workspace/examples/simulations/ota.spice.csv::vin"
                  }
                ],
                nextAxisNumber: 3
              }
            ]
          },
          viewerState: {
            activePlotId: "plot-1",
            activeAxisByPlotId: { "plot-1": "y1" as const }
          },
          reason: "layoutExternalEdit:file-watch"
        }
      }
    ]);

    expect(loadDataset).toHaveBeenCalledTimes(1);
    expect(applyImportedWorkspace).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("suppresses watcher reload for known self-written layout content", () => {
    const panelFixture = createPanelFixture();
    const yamlText = createReferenceOnlySpecYaml("/workspace/examples/simulations/ota.spice.csv");
    const contentHash = createHash("sha256").update(yamlText).digest("hex");
    const applyImportedWorkspace = vi.fn();
    let watchedHandler: (() => void) | undefined;
    const controller = createLayoutExternalEditController({
      debounceMs: 0,
      watchLayout: (_layoutUri, onChange) => {
        watchedHandler = onChange;
        return { dispose: () => undefined };
      },
      readTextFile: () => yamlText,
      readFileStats: () => ({ mtimeMs: 500, sizeBytes: yamlText.length }),
      resolveBindingsForLayout: () => [
        {
          viewerId: "viewer-1",
          datasetPath: "/workspace/examples/simulations/ota.spice.csv",
          panel: panelFixture.panel
        }
      ],
      loadDataset: () => createLoadedDatasetFixture(),
      applyImportedWorkspace,
      getLastSelfWriteMetadata: () => ({
        layoutUri: "/workspace/layouts/lab.wave-viewer.yaml",
        tempUri: "/workspace/layouts/lab.wave-viewer.yaml.tmp-1",
        nonce: "nonce-1",
        revision: 9,
        writtenAtMs: 1000,
        mtimeMs: 500,
        sizeBytes: yamlText.length,
        contentHash
      }),
      showError: vi.fn()
    });
    controller.watchLayout("/workspace/layouts/lab.wave-viewer.yaml");

    watchedHandler?.();

    expect(applyImportedWorkspace).not.toHaveBeenCalled();
    expect(panelFixture.sentMessages).toEqual([]);

    controller.dispose();
  });

  it("keeps previous host state when external layout edit is invalid", () => {
    const panelFixture = createPanelFixture();
    const applyImportedWorkspace = vi.fn();
    const showError = vi.fn();
    let watchedHandler: (() => void) | undefined;
    const controller = createLayoutExternalEditController({
      debounceMs: 0,
      watchLayout: (_layoutUri, onChange) => {
        watchedHandler = onChange;
        return { dispose: () => undefined };
      },
      readTextFile: () => "version: nope",
      readFileStats: () => ({ mtimeMs: 500, sizeBytes: 13 }),
      resolveBindingsForLayout: () => [
        {
          viewerId: "viewer-1",
          datasetPath: "/workspace/examples/simulations/ota.spice.csv",
          panel: panelFixture.panel
        }
      ],
      loadDataset: () => createLoadedDatasetFixture(),
      applyImportedWorkspace,
      getLastSelfWriteMetadata: () => undefined,
      showError
    });
    controller.watchLayout("/workspace/layouts/lab.wave-viewer.yaml");

    watchedHandler?.();

    expect(applyImportedWorkspace).not.toHaveBeenCalled();
    expect(panelFixture.sentMessages).toEqual([]);
    expect(showError).toHaveBeenCalledWith(
      "Wave Viewer layout reload failed for /workspace/layouts/lab.wave-viewer.yaml: Unsupported plot spec version: nope. Supported version is 2."
    );

    controller.dispose();
  });

  it("keeps one watcher per layout and disposes only after final unwatch", () => {
    const disposeHandle = vi.fn();
    const watchLayout = vi.fn((_layoutUri: string, _onChange: () => void) => ({
      dispose: disposeHandle
    }));
    const controller = createLayoutExternalEditController({
      debounceMs: 0,
      watchLayout,
      readTextFile: () => "",
      readFileStats: () => undefined,
      resolveBindingsForLayout: () => [],
      loadDataset: () => createLoadedDatasetFixture(),
      applyImportedWorkspace: vi.fn(),
      getLastSelfWriteMetadata: () => undefined,
      showError: vi.fn()
    });

    controller.watchLayout("/workspace/layouts/lab.wave-viewer.yaml");
    controller.watchLayout("/workspace/layouts/lab.wave-viewer.yaml");
    controller.unwatchLayout("/workspace/layouts/lab.wave-viewer.yaml");

    expect(watchLayout).toHaveBeenCalledTimes(1);
    expect(disposeHandle).not.toHaveBeenCalled();

    controller.unwatchLayout("/workspace/layouts/lab.wave-viewer.yaml");

    expect(disposeHandle).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it("cancels debounced reload when layout is fully unwatched", () => {
    vi.useFakeTimers();
    try {
      let watchedHandler: (() => void) | undefined;
      const applyImportedWorkspace = vi.fn();
      const controller = createLayoutExternalEditController({
        debounceMs: 100,
        watchLayout: (_layoutUri, onChange) => {
          watchedHandler = onChange;
          return { dispose: () => undefined };
        },
        readTextFile: () => createReferenceOnlySpecYaml("/workspace/examples/simulations/ota.spice.csv"),
        readFileStats: () => ({ mtimeMs: 1, sizeBytes: 1 }),
        resolveBindingsForLayout: () => [
          {
            viewerId: "viewer-1",
            datasetPath: "/workspace/examples/simulations/ota.spice.csv",
            panel: createPanelFixture().panel
          }
        ],
        loadDataset: () => createLoadedDatasetFixture(),
        applyImportedWorkspace,
        getLastSelfWriteMetadata: () => undefined,
        showError: vi.fn()
      });

      controller.watchLayout("/workspace/layouts/lab.wave-viewer.yaml");
      watchedHandler?.();
      controller.unwatchLayout("/workspace/layouts/lab.wave-viewer.yaml");
      vi.advanceTimersByTime(100);

      expect(applyImportedWorkspace).not.toHaveBeenCalled();

      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("T-013 side-panel signal actions", () => {
  it("exports side-panel command ids", () => {
    expect(SIGNAL_BROWSER_QUICK_ADD_COMMAND).toBe("waveViewer.signalBrowser.quickAdd");
    expect(SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND).toBe("waveViewer.signalBrowser.addToPlot");
    expect(SIGNAL_BROWSER_ADD_TO_NEW_AXIS_COMMAND).toBe("waveViewer.signalBrowser.addToNewAxis");
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

  it("imports existing sidecar layout on csv load and opens viewer bound to that layout", async () => {
    const registerLoadedDataset = vi.fn();
    const setCachedWorkspace = vi.fn();
    const bindViewerToLayout = vi.fn();
    const openViewerForDataset = vi.fn(async () => "viewer-5");
    const showError = vi.fn();
    const command = createLoadCsvFilesCommand({
      showOpenDialog: async () => ["/workspace/examples/a.csv"],
      loadDataset: (documentPath) => ({
        dataset: {
          path: documentPath,
          rowCount: 2,
          columns: [{ name: "time", values: [0, 1] }, { name: "vin", values: [1, 2] }]
        },
        defaultXSignal: "time"
      }),
      registerLoadedDataset,
      fileExists: (filePath) => filePath === "/workspace/examples/a.csv.wave-viewer.yaml",
      readTextFile: () =>
        createReferenceOnlySpecYaml("/workspace/examples/a.csv"),
      setCachedWorkspace,
      openViewerForDataset,
      bindViewerToLayout,
      showError
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(setCachedWorkspace).toHaveBeenCalledWith("/workspace/examples/a.csv", {
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
    });
    expect(openViewerForDataset).toHaveBeenCalledWith("/workspace/examples/a.csv");
    expect(bindViewerToLayout).toHaveBeenCalledWith(
      "viewer-5",
      "/workspace/examples/a.csv.wave-viewer.yaml",
      "/workspace/examples/a.csv"
    );
  });

  it("creates missing sidecar layout on csv load and opens viewer bound to the created layout", async () => {
    const registerLoadedDataset = vi.fn();
    const writeTextFile = vi.fn();
    const setCachedWorkspace = vi.fn();
    const bindViewerToLayout = vi.fn();
    const openViewerForDataset = vi.fn(async () => "viewer-8");
    const showError = vi.fn();
    const command = createLoadCsvFilesCommand({
      showOpenDialog: async () => ["/workspace/examples/new.csv"],
      loadDataset: (documentPath) => ({
        dataset: {
          path: documentPath,
          rowCount: 2,
          columns: [{ name: "time", values: [0, 1] }, { name: "vin", values: [1, 2] }]
        },
        defaultXSignal: "time"
      }),
      registerLoadedDataset,
      fileExists: () => false,
      writeTextFile,
      setCachedWorkspace,
      openViewerForDataset,
      bindViewerToLayout,
      showError
    });

    await command();

    expect(showError).not.toHaveBeenCalled();
    expect(writeTextFile).toHaveBeenCalledWith(
      "/workspace/examples/new.csv.wave-viewer.yaml",
      expect.stringContaining("version: 2")
    );
    expect(writeTextFile).toHaveBeenCalledWith(
      "/workspace/examples/new.csv.wave-viewer.yaml",
      expect.stringContaining("path: ./new.csv")
    );
    expect(setCachedWorkspace).toHaveBeenCalledWith("/workspace/examples/new.csv", {
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
    });
    expect(openViewerForDataset).toHaveBeenCalledWith("/workspace/examples/new.csv");
    expect(bindViewerToLayout).toHaveBeenCalledWith(
      "viewer-8",
      "/workspace/examples/new.csv.wave-viewer.yaml",
      "/workspace/examples/new.csv"
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
  it("handles validated setActiveAxis intent via host transaction without mutating traces", async () => {
    const initialWorkspace: WorkspaceState = {
      activePlotId: "plot-1",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          axes: [{ id: "y1" }, { id: "y2" }],
          traces: [
            {
              id: "trace-1",
              signal: "vin",
              sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
              axisId: "y1",
              visible: true
            }
          ],
          nextAxisNumber: 3
        }
      ]
    };
    const { deps, panelFixture, setCachedWorkspace } = createDeps({
      initialWorkspace
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/intent/setActiveAxis", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        axisId: "y2",
        requestId: "req-set-axis-1"
      })
    );

    expect(setCachedWorkspace).not.toHaveBeenCalled();
    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/statePatch",
        payload: {
          revision: 1,
          workspace: initialWorkspace,
          viewerState: {
            activePlotId: "plot-1",
            activeAxisByPlotId: {
              "plot-1": "y2"
            }
          },
          reason: "setActiveAxis:lane-click"
        }
      }
    ]);
  });

  it("handles validated dropSignal intent via host transaction and posts statePatch", async () => {
    const { deps, panelFixture, setCachedWorkspace } = createDeps({
      initialWorkspace: createWorkspaceFixture()
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/intent/dropSignal", {
        viewerId: "viewer-1",
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis", axisId: "y1" },
        source: "axis-row",
        requestId: "req-1"
      })
    );

    expect(setCachedWorkspace).not.toHaveBeenCalled();
    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/tupleUpsert",
        payload: {
          tuples: [
            {
              traceId: "trace-1",
              sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
              datasetPath: "/workspace/examples/simulations/ota.spice.csv",
              xName: "time",
              yName: "vin",
              x: [0, 1, 2],
              y: [1, 2, 3]
            }
          ]
        }
      },
      {
        version: PROTOCOL_VERSION,
        type: "host/statePatch",
        payload: {
          revision: 1,
          workspace: {
            activePlotId: "plot-1",
            plots: [
              {
                id: "plot-1",
                name: "Plot 1",
                xSignal: "time",
                axes: [{ id: "y1", title: "Voltage (V)" }],
                traces: [
                  {
                    id: "trace-1",
                    signal: "vin",
                    sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
                    axisId: "y1",
                    visible: true
                  }
                ],
                nextAxisNumber: 2
              }
            ]
          },
          viewerState: {
            activePlotId: "plot-1",
            activeAxisByPlotId: {
              "plot-1": "y1"
            }
          },
          reason: "dropSignal:axis-row"
        }
      }
    ]);
  });

  it("handles validated setTraceAxis intent via host transaction and persists lane reassignment", async () => {
    const initialWorkspace: WorkspaceState = {
      activePlotId: "plot-1",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          axes: [{ id: "y1" }, { id: "y2" }],
          traces: [
            {
              id: "trace-1",
              signal: "vin",
              sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
              axisId: "y1",
              visible: true
            }
          ],
          nextAxisNumber: 3
        }
      ]
    };
    const { deps, panelFixture } = createDeps({
      initialWorkspace
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/intent/setTraceAxis", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        traceId: "trace-1",
        axisId: "y2",
        requestId: "req-set-trace-axis-1"
      })
    );

    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/statePatch",
        payload: {
          revision: 1,
          workspace: {
            activePlotId: "plot-1",
            plots: [
              {
                id: "plot-1",
                name: "Plot 1",
                xSignal: "time",
                axes: [{ id: "y1" }, { id: "y2" }],
                traces: [
                  {
                    id: "trace-1",
                    signal: "vin",
                    sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
                    axisId: "y2",
                    visible: true
                  }
                ],
                nextAxisNumber: 3
              }
            ]
          },
          viewerState: {
            activePlotId: "plot-1",
            activeAxisByPlotId: {
              "plot-1": "y2"
            }
          },
          reason: "setTraceAxis:lane-drag"
        }
      }
    ]);
  });

  it("handles validated addAxis intent via host transaction and activates the new lane", async () => {
    const initialWorkspace: WorkspaceState = {
      activePlotId: "plot-1",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          axes: [{ id: "y1" }, { id: "y2" }],
          traces: [],
          nextAxisNumber: 3
        }
      ]
    };
    const { deps, panelFixture } = createDeps({
      initialWorkspace
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/intent/addAxis", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        afterAxisId: "y1",
        requestId: "req-add-axis-1"
      })
    );

    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/statePatch",
        payload: {
          revision: 1,
          workspace: {
            activePlotId: "plot-1",
            plots: [
              {
                id: "plot-1",
                name: "Plot 1",
                xSignal: "time",
                axes: [{ id: "y1" }, { id: "y3" }, { id: "y2" }],
                traces: [],
                nextAxisNumber: 4
              }
            ]
          },
          viewerState: {
            activePlotId: "plot-1",
            activeAxisByPlotId: {
              "plot-1": "y3"
            }
          },
          reason: "addAxis:lane-click"
        }
      }
    ]);
  });

  it("handles validated setActivePlot intent via host transaction and posts statePatch", async () => {
    const initialWorkspace: WorkspaceState = {
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
          traces: [],
          nextAxisNumber: 2
        }
      ]
    };
    const { deps, panelFixture } = createDeps({
      initialWorkspace
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/intent/setActivePlot", {
        viewerId: "viewer-1",
        plotId: "plot-2",
        requestId: "req-set-plot-1"
      })
    );

    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/statePatch",
        payload: {
          revision: 1,
          workspace: {
            activePlotId: "plot-2",
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
                traces: [],
                nextAxisNumber: 2
              }
            ]
          },
          viewerState: {
            activePlotId: "plot-2",
            activeAxisByPlotId: {
              "plot-1": "y1",
              "plot-2": "y1"
            }
          },
          reason: "setActivePlot:tab-select"
        }
      }
    ]);
  });

  it("handles validated addPlot intent via host transaction and posts statePatch", async () => {
    const { deps, panelFixture } = createDeps({
      initialWorkspace: createWorkspaceFixture()
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/intent/addPlot", {
        viewerId: "viewer-1",
        xSignal: "time",
        requestId: "req-add-plot-1"
      })
    );

    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/statePatch",
        payload: {
          revision: 1,
          workspace: {
            activePlotId: "plot-2",
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
                traces: [],
                nextAxisNumber: 2
              }
            ]
          },
          viewerState: {
            activePlotId: "plot-2",
            activeAxisByPlotId: {
              "plot-1": "y1",
              "plot-2": "y1"
            }
          },
          reason: "addPlot:tab-add"
        }
      }
    ]);
  });

  it("handles validated removePlot intent via host transaction and posts statePatch", async () => {
    const initialWorkspace: WorkspaceState = {
      activePlotId: "plot-2",
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
          traces: [],
          nextAxisNumber: 2
        }
      ]
    };
    const { deps, panelFixture } = createDeps({
      initialWorkspace
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/intent/removePlot", {
        viewerId: "viewer-1",
        plotId: "plot-2",
        requestId: "req-remove-plot-1"
      })
    );

    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/statePatch",
        payload: {
          revision: 1,
          workspace: {
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
          viewerState: {
            activePlotId: "plot-1",
            activeAxisByPlotId: {
              "plot-1": "y1"
            }
          },
          reason: "removePlot:tab-remove"
        }
      }
    ]);
  });

  it("handles validated clearPlot intent via host transaction and posts statePatch", async () => {
    const initialWorkspace: WorkspaceState = {
      activePlotId: "plot-2",
      plots: [
        {
          id: "plot-1",
          name: "Plot 1",
          xSignal: "time",
          axes: [{ id: "y1" }, { id: "y2" }],
          traces: [{ id: "trace-1", signal: "vin", axisId: "y2", visible: true }],
          nextAxisNumber: 3
        },
        {
          id: "plot-2",
          name: "Scope B",
          xSignal: "frequency",
          axes: [{ id: "y1" }, { id: "y2" }],
          traces: [{ id: "trace-2", signal: "vout", axisId: "y2", visible: true }],
          nextAxisNumber: 3
        }
      ]
    };
    const { deps, panelFixture } = createDeps({
      initialWorkspace
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/intent/clearPlot", {
        viewerId: "viewer-1",
        plotId: "plot-2",
        requestId: "req-clear-plot-1"
      })
    );

    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/statePatch",
        payload: {
          revision: 1,
          workspace: {
            activePlotId: "plot-2",
            plots: [
              {
                id: "plot-1",
                name: "Plot 1",
                xSignal: "time",
                axes: [{ id: "y1" }, { id: "y2" }],
                traces: [{ id: "trace-1", signal: "vin", axisId: "y2", visible: true }],
                nextAxisNumber: 3
              },
              {
                id: "plot-2",
                name: "Scope B",
                xSignal: "frequency",
                axes: [{ id: "y1" }],
                traces: [],
                nextAxisNumber: 2
              }
            ]
          },
          viewerState: {
            activePlotId: "plot-2",
            activeAxisByPlotId: {
              "plot-1": "y1",
              "plot-2": "y1"
            }
          },
          reason: "clearPlot:plot-header"
        }
      }
    ]);
  });

  it("handles validated renamePlot intent via host transaction and trims the name", async () => {
    const { deps, panelFixture } = createDeps({
      initialWorkspace: createWorkspaceFixture()
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/intent/renamePlot", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        name: "  Scope A  ",
        requestId: "req-rename-plot-1"
      })
    );

    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/statePatch",
        payload: {
          revision: 1,
          workspace: {
            activePlotId: "plot-1",
            plots: [
              {
                id: "plot-1",
                name: "Scope A",
                xSignal: "time",
                axes: [{ id: "y1" }],
                traces: [],
                nextAxisNumber: 2
              }
            ]
          },
          viewerState: {
            activePlotId: "plot-1",
            activeAxisByPlotId: {
              "plot-1": "y1"
            }
          },
          reason: "renamePlot:tab-rename"
        }
      }
    ]);
  });

  it("persists renamePlot after host patch and subsequent webview ready snapshot", async () => {
    const { deps, panelFixture } = createDeps({
      initialWorkspace: createWorkspaceFixture()
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/intent/renamePlot", {
        viewerId: "viewer-1",
        plotId: "plot-1",
        name: "Persistent Name",
        requestId: "req-rename-plot-2"
      })
    );
    panelFixture.emitMessage(createProtocolEnvelope("webview/ready", { ready: true }));

    let latestSnapshot: HostToWebviewMessage | undefined;
    for (const message of panelFixture.sentMessages) {
      if (message.type === "host/stateSnapshot") {
        latestSnapshot = message;
      }
    }
    expect(latestSnapshot).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/stateSnapshot",
      payload: {
        revision: 1,
        workspace: {
          activePlotId: "plot-1",
          plots: [
            {
              id: "plot-1",
              name: "Persistent Name",
              xSignal: "time",
              axes: [{ id: "y1" }],
              traces: [],
              nextAxisNumber: 2
            }
          ]
        },
        viewerState: {
          activePlotId: "plot-1",
          activeAxisByPlotId: {
            "plot-1": "y1"
          }
        }
      }
    });
  });

  it("ignores invalid dropSignal payloads and does not mutate workspace", async () => {
    const { deps, panelFixture, logDebug, setCachedWorkspace } = createDeps({
      initialWorkspace: createWorkspaceFixture()
    });

    await createOpenViewerCommand(deps)();

    panelFixture.emitMessage(
      createProtocolEnvelope("webview/intent/dropSignal", {
        viewerId: "viewer-1",
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis" },
        source: "axis-row",
        requestId: "req-1"
      })
    );

    expect(setCachedWorkspace).not.toHaveBeenCalled();
    expect(panelFixture.sentMessages).toEqual([]);
    expect(logDebug).toHaveBeenCalledWith(
      "Ignored invalid or unknown webview message.",
      expect.objectContaining({
        type: "webview/intent/dropSignal"
      })
    );
  });

  it("keeps reducer outcomes deterministic for equivalent add intents", () => {
    const initial = createWorkspaceFixture();
    const fromSidePanel = applySidePanelSignalAction(initial, { type: "add-to-plot", signal: "vin" });
    const fromDropSignal = applyDropSignalAction(initial, {
      viewerId: "viewer-1",
      signal: "vin",
      plotId: "plot-1",
      target: { kind: "axis", axisId: "y1" },
      source: "axis-row",
      requestId: "req-1"
    });

    expect(fromDropSignal).toEqual(fromSidePanel);
  });

  it("keeps equivalent workspace outcomes across side-panel, axis-row drop, and canvas-overlay drop", () => {
    const fromSidePanel = applySidePanelSignalAction(createWorkspaceFixture(), {
      type: "add-to-plot",
      signal: "vin"
    });
    const fromAxisRowDrop = applyDropSignalAction(createWorkspaceFixture(), {
      viewerId: "viewer-1",
      signal: "vin",
      plotId: "plot-1",
      target: { kind: "axis", axisId: "y1" },
      source: "axis-row",
      requestId: "req-1"
    });
    const fromCanvasOverlayDrop = applyDropSignalAction(createWorkspaceFixture(), {
      viewerId: "viewer-1",
      signal: "vin",
      plotId: "plot-1",
      target: { kind: "axis", axisId: "y1" },
      source: "canvas-overlay",
      requestId: "req-2"
    });

    expect(fromAxisRowDrop).toEqual(fromSidePanel);
    expect(fromCanvasOverlayDrop).toEqual(fromSidePanel);
    expect(fromCanvasOverlayDrop).toEqual(fromAxisRowDrop);
  });

  it("handles dropSignal new-axis target by creating one axis and binding the dropped trace", () => {
    const next = applyDropSignalAction(createWorkspaceFixture(), {
      viewerId: "viewer-1",
      signal: "vin",
      plotId: "plot-1",
      target: { kind: "new-axis" },
      source: "axis-row",
      requestId: "req-1"
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

  it("inserts dropSignal new-axis target directly after the requested anchor axis", () => {
    const seededWorkspace = applySidePanelSignalAction(createWorkspaceFixture(), {
      type: "add-to-new-axis",
      signal: "seed"
    });
    const next = applyDropSignalAction(seededWorkspace, {
      viewerId: "viewer-1",
      signal: "vin",
      plotId: "plot-1",
      target: { kind: "new-axis", afterAxisId: "y1" },
      source: "axis-row",
      requestId: "req-1"
    });

    expect(next.plots[0]?.axes.map((axis) => axis.id)).toEqual(["y1", "y3", "y2"]);
    expect(next.plots[0]?.traces.map((trace) => ({ signal: trace.signal, axisId: trace.axisId }))).toEqual([
      { signal: "seed", axisId: "y2" },
      { signal: "vin", axisId: "y3" }
    ]);
  });

  it("keeps equivalent new-axis workspace outcomes across side-panel and both drop sources", () => {
    const fromSidePanel = applySidePanelSignalAction(createWorkspaceFixture(), {
      type: "add-to-new-axis",
      signal: "vin"
    });
    const fromAxisRowDrop = applyDropSignalAction(createWorkspaceFixture(), {
      viewerId: "viewer-1",
      signal: "vin",
      plotId: "plot-1",
      target: { kind: "new-axis" },
      source: "axis-row",
      requestId: "req-1"
    });
    const fromCanvasOverlayDrop = applyDropSignalAction(createWorkspaceFixture(), {
      viewerId: "viewer-1",
      signal: "vin",
      plotId: "plot-1",
      target: { kind: "new-axis" },
      source: "canvas-overlay",
      requestId: "req-2"
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
      createProtocolEnvelope("webview/intent/dropSignal", {
        viewerId: "viewer-1",
        signal: "vin",
        plotId: "plot-1",
        target: { kind: "axis", axisId: "y1" },
        source: "canvas-overlay",
        requestId: "req-2"
      })
    );

    expect(setCachedWorkspace).not.toHaveBeenCalled();
    expect(panelFixture.sentMessages).toEqual([
      {
        version: PROTOCOL_VERSION,
        type: "host/tupleUpsert",
        payload: {
          tuples: [
            {
              traceId: "trace-1",
              sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
              datasetPath: "/workspace/examples/simulations/ota.spice.csv",
              xName: "time",
              yName: "vin",
              x: [0, 1, 2],
              y: [1, 2, 3]
            }
          ]
        }
      },
      {
        version: PROTOCOL_VERSION,
        type: "host/statePatch",
        payload: {
          revision: 1,
          workspace: {
            activePlotId: "plot-1",
            plots: [
              {
                id: "plot-1",
                name: "Plot 1",
                xSignal: "time",
                axes: [{ id: "y1", title: "Voltage (V)" }],
                traces: [
                  {
                    id: "trace-1",
                    signal: "vin",
                    sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
                    axisId: "y1",
                    visible: true
                  }
                ],
                nextAxisNumber: 2
              }
            ]
          },
          viewerState: {
            activePlotId: "plot-1",
            activeAxisByPlotId: {
              "plot-1": "y1"
            }
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

describe("T-028 signal panel structure", () => {
  it("renders lane-assignment signal sections in webview layout and styling", () => {
    const html = fs.readFileSync(path.resolve("src/webview/index.html"), "utf8");
    const css = fs.readFileSync(path.resolve("src/webview/styles.css"), "utf8");

    expect(html).toContain('id="signal-list"');
    expect(css).toContain(".signal-panel-section");
    expect(css).toContain(".signal-panel-section-title");
  });

  it("wires active plot traces into signal panel rendering", () => {
    const source = fs.readFileSync(path.resolve("src/webview/main.ts"), "utf8");

    expect(source).toContain("renderSignalList({");
    expect(source).toContain("traces: activePlot.traces");
  });
});

describe("T-025 standalone viewer side-panel routing", () => {
  it("binds a standalone viewer action target and posts tuple + patch messages", () => {
    const panelFixture = createPanelFixture();
    const showWarning = vi.fn();
    const bindPanelToDataset = vi.fn();
    const store = createHostStateStore();
    let standalonePanel: WebviewPanelLike | undefined = panelFixture.panel;

    const nextWorkspace = runResolvedSidePanelSignalAction({
      actionType: "add-to-plot",
      documentPath: "/workspace/examples/simulations/ota.spice.csv",
      loadedDataset: createLoadedDatasetFixture(),
      signal: "vin",
      commitHostStateTransaction: (transaction) => store.commitTransaction(transaction),
      getBoundPanel: () => undefined,
      getStandalonePanel: () => standalonePanel,
      bindPanelToDataset: (_documentPath, panel) => {
        bindPanelToDataset();
        expect(panel).toBe(panelFixture.panel);
        return "viewer-1";
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
      {
        id: "trace-1",
        signal: "vin",
        sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
        axisId: "y1",
        visible: true
      }
    ]);
    expect(panelFixture.sentMessages.map((message) => message.type)).toEqual([
      "host/viewerBindingUpdated",
      "host/tupleUpsert",
      "host/statePatch"
    ]);
    expect(panelFixture.sentMessages[0]).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/viewerBindingUpdated",
      payload: {
        viewerId: "viewer-1",
        datasetPath: undefined
      }
    });
    expect(panelFixture.sentMessages[1]).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/tupleUpsert",
      payload: {
        tuples: [
          {
            traceId: "trace-1",
            sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
            datasetPath: "/workspace/examples/simulations/ota.spice.csv",
            xName: "time",
            yName: "vin",
            x: [0, 1, 2],
            y: [1, 2, 3]
          }
        ]
      }
    });
    expect(panelFixture.sentMessages[2]).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/statePatch",
      payload: {
        revision: 1,
        workspace: nextWorkspace,
        viewerState: {
          activePlotId: "plot-1",
          activeAxisByPlotId: {
            "plot-1": "y1"
          }
        },
        reason: "sidePanel:add-to-plot"
      }
    });
  });

  it("shows actionable warning when no viewer target can accept the action", () => {
    const showWarning = vi.fn();
    const store = createHostStateStore();
    const nextWorkspace = runResolvedSidePanelSignalAction({
      actionType: "add-to-plot",
      documentPath: "/workspace/examples/simulations/ota.spice.csv",
      loadedDataset: createLoadedDatasetFixture(),
      signal: "vin",
      commitHostStateTransaction: (transaction) => store.commitTransaction(transaction),
      getBoundPanel: () => undefined,
      getStandalonePanel: () => undefined,
      bindPanelToDataset: () => undefined,
      clearStandalonePanel: () => undefined,
      showWarning
    });

    expect(nextWorkspace.plots[0]?.traces).toEqual([
      {
        id: "trace-1",
        signal: "vin",
        sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
        axisId: "y1",
        visible: true
      }
    ]);
    expect(showWarning).toHaveBeenCalledWith(
      createNoTargetViewerWarning("add-to-plot", "/workspace/examples/simulations/ota.spice.csv")
    );
    expect(createNoTargetViewerWarning("add-to-plot", "/workspace/examples/simulations/ota.spice.csv"))
      .toContain("Open Wave Viewer for that CSV and retry.");
  });
});

describe("T-027 side-panel quick-add tuple injection", () => {
  it("routes quick-add to a standalone target and posts tupleUpsert payload", () => {
    const panelFixture = createPanelFixture();
    const bindViewerToDataset = vi.fn();
    const showError = vi.fn();

    const ok = runResolvedSidePanelQuickAdd({
      documentPath: "/workspace/examples/simulations/ota.spice.csv",
      loadedDataset: createLoadedDatasetFixture(),
      signal: "vin",
      quickAddTarget: {
        plotId: "plot-2",
        axisId: "y2"
      },
      targetViewer: {
        viewerId: "viewer-7",
        panel: panelFixture.panel,
        bindDataset: true
      },
      bindViewerToDataset,
      showError
    });

    expect(ok).toBe(true);
    expect(showError).not.toHaveBeenCalled();
    expect(bindViewerToDataset).toHaveBeenCalledWith(
      "viewer-7",
      "/workspace/examples/simulations/ota.spice.csv"
    );
    expect(panelFixture.sentMessages.map((message) => message.type)).toEqual([
      "host/viewerBindingUpdated",
      "host/tupleUpsert",
      "host/sidePanelQuickAdd"
    ]);
    expect(panelFixture.sentMessages[1]).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/tupleUpsert",
      payload: {
        tuples: [
          {
            traceId: "viewer-7:vin:3",
            sourceId: "/workspace/examples/simulations/ota.spice.csv::vin",
            datasetPath: "/workspace/examples/simulations/ota.spice.csv",
            xName: "time",
            yName: "vin",
            x: [0, 1, 2],
            y: [1, 2, 3]
          }
        ]
      }
    });
    expect(panelFixture.sentMessages[2]).toEqual({
      version: PROTOCOL_VERSION,
      type: "host/sidePanelQuickAdd",
      payload: {
        signal: "vin",
        plotId: "plot-2",
        axisId: "y2"
      }
    });
  });

  it("supports mixed-grid tuple injections from different sources in one viewer session", () => {
    const panelFixture = createPanelFixture();
    const bindViewerToDataset = vi.fn();
    const showError = vi.fn();

    const first = runResolvedSidePanelQuickAdd({
      documentPath: "/workspace/examples/a.csv",
      loadedDataset: {
        dataset: {
          path: "/workspace/examples/a.csv",
          rowCount: 3,
          columns: [
            { name: "time", values: [0, 1, 2] },
            { name: "vin", values: [1, 2, 3] }
          ]
        },
        defaultXSignal: "time"
      },
      signal: "vin",
      targetViewer: {
        viewerId: "viewer-9",
        panel: panelFixture.panel,
        bindDataset: false
      },
      bindViewerToDataset,
      showError
    });

    const second = runResolvedSidePanelQuickAdd({
      documentPath: "/workspace/examples/b.csv",
      loadedDataset: {
        dataset: {
          path: "/workspace/examples/b.csv",
          rowCount: 3,
          columns: [
            { name: "frequency", values: [10, 100, 1000] },
            { name: "vin", values: [0.1, 0.2, 0.3] }
          ]
        },
        defaultXSignal: "frequency"
      },
      signal: "vin",
      targetViewer: {
        viewerId: "viewer-9",
        panel: panelFixture.panel,
        bindDataset: false
      },
      bindViewerToDataset,
      showError
    });

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(bindViewerToDataset).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();

    const tuplePayloads = panelFixture.sentMessages
      .filter((message) => message.type === "host/tupleUpsert")
      .map((message) => message.payload.tuples[0]);
    const quickAddPayloads = panelFixture.sentMessages
      .filter((message) => message.type === "host/sidePanelQuickAdd")
      .map((message) => message.payload.signal);

    expect(tuplePayloads).toHaveLength(2);
    expect(quickAddPayloads).toEqual(["vin", "vin"]);
    expect(tuplePayloads[0]).toMatchObject({
      sourceId: "/workspace/examples/a.csv::vin",
      xName: "time",
      x: [0, 1, 2],
      y: [1, 2, 3]
    });
    expect(tuplePayloads[1]).toMatchObject({
      sourceId: "/workspace/examples/b.csv::vin",
      xName: "frequency",
      x: [10, 100, 1000],
      y: [0.1, 0.2, 0.3]
    });
  });
});

describe("T-026 viewer session registry", () => {
  function selectTarget(
    registry: ViewerSessionRegistry,
    datasetPath: string,
    options?: { explicitViewerId?: string }
  ): string | undefined {
    return registry.resolveTargetViewerSession(datasetPath, options)?.viewerId;
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

  it("uses <csv>.wave-viewer.yaml fallback identity for dataset-bound viewers", () => {
    const registry = createViewerSessionRegistry();
    const panel = createRegistryPanelFixture();
    const viewerId = registry.registerPanel(panel.panel, "/workspace/examples/a.csv");

    expect(registry.getViewerSessionContext(viewerId)).toEqual({
      datasetPath: "/workspace/examples/a.csv",
      layoutUri: "/workspace/examples/a.csv.wave-viewer.yaml"
    });
  });

  it("supports explicit layout binding and resolves dataset from that layout context", () => {
    const registry = createViewerSessionRegistry();
    const panel = createRegistryPanelFixture();
    const viewerId = registry.registerPanel(panel.panel);

    registry.bindViewerToLayout(
      viewerId,
      "/workspace/layouts/shared-lab.wave-viewer.yaml",
      "/workspace/examples/b.csv"
    );

    expect(registry.getViewerSessionContext(viewerId)).toEqual({
      datasetPath: "/workspace/examples/b.csv",
      layoutUri: "/workspace/layouts/shared-lab.wave-viewer.yaml"
    });
    expect(registry.resolveTargetViewerSession("/workspace/examples/b.csv")?.viewerId).toBe(viewerId);
  });

  it("honors explicit target viewer before focused and dataset-bound fallback", () => {
    const registry = createViewerSessionRegistry();
    const panelA = createRegistryPanelFixture();
    const panelB = createRegistryPanelFixture();
    const viewerA = registry.registerPanel(panelA.panel, "/workspace/examples/a.csv");
    const viewerB = registry.registerPanel(panelB.panel, "/workspace/examples/a.csv");

    registry.markViewerFocused(viewerB);
    expect(selectTarget(registry, "/workspace/examples/a.csv")).toBe(viewerB);
    expect(
      selectTarget(registry, "/workspace/examples/a.csv", {
        explicitViewerId: viewerA
      })
    ).toBe(viewerA);
  });

  it("uses explicit standalone viewer as bind target and falls back when explicit target is unknown", () => {
    const registry = createViewerSessionRegistry();
    const boundPanel = createRegistryPanelFixture();
    const standalonePanel = createRegistryPanelFixture();
    const boundViewer = registry.registerPanel(boundPanel.panel, "/workspace/examples/a.csv");
    const standaloneViewer = registry.registerPanel(standalonePanel.panel);

    const explicitStandalone = registry.resolveTargetViewerSession("/workspace/examples/b.csv", {
      explicitViewerId: standaloneViewer
    });
    expect(explicitStandalone?.viewerId).toBe(standaloneViewer);
    expect(explicitStandalone?.bindDataset).toBe(true);

    const fallback = registry.resolveTargetViewerSession("/workspace/examples/a.csv", {
      explicitViewerId: "viewer-404"
    });
    expect(fallback?.viewerId).toBe(standaloneViewer);
    expect(fallback?.bindDataset).toBe(true);
  });
});

describe("T-032 host-authoritative workspace state store", () => {
  it("rejects removed webview/workspaceChanged messages as invalid webview input", async () => {
    const { deps, panelFixture, setCachedWorkspace, logDebug } = createDeps({
      initialWorkspace: createWorkspaceFixture()
    });

    await createOpenViewerCommand(deps)();
    panelFixture.emitMessage(
      createProtocolEnvelope("webview/workspaceChanged", {
        workspace: createWorkspaceFixture(),
        reason: "webview-sync"
      })
    );

    expect(setCachedWorkspace).not.toHaveBeenCalled();
    expect(logDebug).toHaveBeenCalledWith(
      "Ignored invalid or unknown webview message.",
      expect.objectContaining({ type: "webview/workspaceChanged" })
    );
  });

  it("commits add-to-new-axis atomically under a single revision increment", () => {
    const store = createHostStateStore();

    const initial = store.ensureSnapshot("/workspace/examples/simulations/ota.spice.csv", "time");
    const result = store.commitTransaction({
      datasetPath: "/workspace/examples/simulations/ota.spice.csv",
      defaultXSignal: "time",
      reason: "sidePanel:add-to-new-axis",
      mutate: (workspace) => applySidePanelSignalAction(workspace, { type: "add-to-new-axis", signal: "vin" })
    });

    expect(initial.revision).toBe(0);
    expect(result.previous.revision).toBe(0);
    expect(result.next.revision).toBe(1);
    expect(result.next.workspace.plots[0]?.axes.map((axis) => axis.id)).toEqual(["y1", "y2"]);
    expect(result.next.workspace.plots[0]?.traces).toEqual([
      {
        id: "trace-1",
        signal: "vin",
        axisId: "y2",
        visible: true
      }
    ]);
  });

  it("increments revision monotonically for sequential host transactions", () => {
    const store = createHostStateStore();
    const datasetPath = "/workspace/examples/simulations/ota.spice.csv";

    const first = store.commitTransaction({
      datasetPath,
      defaultXSignal: "time",
      reason: "sidePanel:add-to-plot",
      mutate: (workspace) => applySidePanelSignalAction(workspace, { type: "add-to-plot", signal: "vin" })
    });
    const second = store.commitTransaction({
      datasetPath,
      defaultXSignal: "time",
      reason: "sidePanel:add-to-plot",
      mutate: (workspace) => applySidePanelSignalAction(workspace, { type: "add-to-plot", signal: "vout" })
    });

    expect(first.next.revision).toBe(1);
    expect(second.previous.revision).toBe(1);
    expect(second.next.revision).toBe(2);
    expect(second.next.workspace.plots[0]?.traces.map((trace) => trace.signal)).toEqual(["vin", "vout"]);
  });
});

describe("T-035 active-axis targeting semantics", () => {
  it("targets active axis by default for add-to-plot mutations", () => {
    const store = createHostStateStore();
    const datasetPath = "/workspace/examples/simulations/ota.spice.csv";

    store.commitTransaction({
      datasetPath,
      defaultXSignal: "time",
      reason: "seed:add-axis",
      mutate: (workspace) => applySidePanelSignalAction(workspace, { type: "add-to-new-axis", signal: "seed" }),
      selectActiveAxis: ({ nextWorkspace }) => ({ plotId: nextWorkspace.activePlotId, axisId: "y2" })
    });

    const result = store.commitTransaction({
      datasetPath,
      defaultXSignal: "time",
      reason: "sidePanel:add-to-plot",
      mutate: (workspace, viewerState) =>
        applySidePanelSignalAction(workspace, { type: "add-to-plot", signal: "vin" }, {
          axisId: viewerState.activeAxisByPlotId[workspace.activePlotId]
        })
    });

    expect(result.next.workspace.plots[0]?.traces.map((trace) => ({ signal: trace.signal, axisId: trace.axisId }))).toEqual([
      { signal: "seed", axisId: "y2" },
      { signal: "vin", axisId: "y2" }
    ]);
    expect(result.next.viewerState.activeAxisByPlotId["plot-1"]).toBe("y2");
  });

  it("activates newly created axis in the same add-to-new-axis transaction", () => {
    const store = createHostStateStore();
    const datasetPath = "/workspace/examples/simulations/ota.spice.csv";

    const result = store.commitTransaction({
      datasetPath,
      defaultXSignal: "time",
      reason: "sidePanel:add-to-new-axis",
      mutate: (workspace) => applySidePanelSignalAction(workspace, { type: "add-to-new-axis", signal: "vin" }),
      selectActiveAxis: ({ previous, nextWorkspace }) => {
        const previousPlot = previous.workspace.plots.find((plot) => plot.id === nextWorkspace.activePlotId);
        const nextPlot = nextWorkspace.plots.find((plot) => plot.id === nextWorkspace.activePlotId);
        if (!nextPlot) {
          return undefined;
        }
        const previousAxisIds = new Set(previousPlot?.axes.map((axis) => axis.id) ?? []);
        const newAxis = nextPlot.axes.find((axis) => !previousAxisIds.has(axis.id));
        if (!newAxis) {
          return undefined;
        }
        return { plotId: nextPlot.id, axisId: newAxis.id };
      }
    });

    expect(result.next.workspace.plots[0]?.axes.map((axis) => axis.id)).toEqual(["y1", "y2"]);
    expect(result.next.viewerState.activeAxisByPlotId["plot-1"]).toBe("y2");
  });

  it("falls back to the first axis when prior active axis no longer exists", () => {
    const store = createHostStateStore();
    const datasetPath = "/workspace/examples/simulations/ota.spice.csv";

    store.commitTransaction({
      datasetPath,
      defaultXSignal: "time",
      reason: "seed:add-axis",
      mutate: (workspace) =>
        reduceWorkspaceState(workspace, {
          type: "axis/add"
        }),
      selectActiveAxis: ({ nextWorkspace }) => ({ plotId: nextWorkspace.activePlotId, axisId: "y2" })
    });

    const result = store.commitTransaction({
      datasetPath,
      defaultXSignal: "time",
      reason: "axis:remove-no-reassign",
      mutate: (workspace) =>
        reduceWorkspaceState(workspace, {
          type: "axis/remove",
          payload: { axisId: "y2" }
        })
    });

    expect(result.next.workspace.plots[0]?.axes.map((axis) => axis.id)).toEqual(["y1"]);
    expect(result.next.viewerState.activeAxisByPlotId["plot-1"]).toBe("y1");
  });

  it("reassigns active axis to the remove-axis reassignment target when traces move", () => {
    const store = createHostStateStore();
    const datasetPath = "/workspace/examples/simulations/ota.spice.csv";

    store.commitTransaction({
      datasetPath,
      defaultXSignal: "time",
      reason: "seed:add-axis",
      mutate: (workspace) => applySidePanelSignalAction(workspace, { type: "add-to-new-axis", signal: "vin" }),
      selectActiveAxis: ({ nextWorkspace }) => ({ plotId: nextWorkspace.activePlotId, axisId: "y2" })
    });

    const result = store.commitTransaction({
      datasetPath,
      defaultXSignal: "time",
      reason: "axis:remove-with-reassign",
      mutate: (workspace) =>
        reduceWorkspaceState(workspace, {
          type: "axis/remove",
          payload: { axisId: "y2", reassignToAxisId: "y1" }
        })
    });

    expect(result.next.workspace.plots[0]?.axes.map((axis) => axis.id)).toEqual(["y1"]);
    expect(result.next.workspace.plots[0]?.traces.map((trace) => trace.axisId)).toEqual(["y1"]);
    expect(result.next.viewerState.activeAxisByPlotId["plot-1"]).toBe("y1");
  });
});

describe("T-033 revisioned protocol semantics", () => {
  it("enforces stale host-state rejection in webview message handling", () => {
    const source = fs.readFileSync(path.resolve("src/webview/main.ts"), "utf8");

    expect(source).toContain("let lastAppliedRevision = -1;");
    expect(source).toContain("if (message.payload.revision <= lastAppliedRevision) {");
    expect(source).toContain("Ignored stale host snapshot revision.");
    expect(source).toContain("Ignored stale host patch revision.");
  });

  it("uses v2 intent and host state message names", () => {
    const source = fs.readFileSync(path.resolve("src/webview/main.ts"), "utf8");
    const hostSource = fs.readFileSync(path.resolve("src/extension/commands.ts"), "utf8");

    expect(source).toContain('createProtocolEnvelope("webview/intent/dropSignal"');
    expect(hostSource).not.toContain('"webview/dropSignal"');
    expect(source).toContain('if (message.type === "host/stateSnapshot")');
    expect(source).toContain('if (message.type === "host/statePatch")');
    expect(source).toContain('if (message.type === "host/tupleUpsert")');
  });
});

describe("T-039 lane activation intent wiring", () => {
  it("wires lane click activation from signal board to setActiveAxis intent", () => {
    const webviewSource = fs.readFileSync(path.resolve("src/webview/main.ts"), "utf8");
    const signalListSource = fs.readFileSync(path.resolve("src/webview/components/SignalList.ts"), "utf8");

    expect(webviewSource).toContain('createProtocolEnvelope("webview/intent/setActiveAxis"');
    expect(webviewSource).toContain("onActivateLane: (axisId) => postSetActiveAxis(axisId)");
    expect(webviewSource).toContain("activeAxisId: preferredDropAxisId");
    expect(signalListSource).toContain("props.onActivateLane(lane.axisId);");
    expect(signalListSource).toContain('laneSection.section.classList.toggle("axis-row-active", lane.axisId === props.activeAxisId);');
  });
});

describe("T-040 new-lane drop target placement and insertion anchor wiring", () => {
  it("places the new-lane creation target in signal list and wires click creation intent", () => {
    const signalListSource = fs.readFileSync(path.resolve("src/webview/components/SignalList.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("src/webview/main.ts"), "utf8");
    const htmlSource = fs.readFileSync(path.resolve("src/webview/index.html"), "utf8");

    expect(signalListSource).toContain('body.textContent = "Click here to create a new lane";');
    expect(signalListSource).toContain("options.onCreateLane(options.afterAxisId);");
    expect(signalListSource).toContain('target: { kind: "new-axis", afterAxisId: lastLaneAxisId }');
    expect(mainSource).toContain('createProtocolEnvelope("webview/intent/addAxis"');
    expect(mainSource).not.toContain("renderAxisManager({");
    expect(htmlSource).not.toContain('id="axis-manager"');
  });
});

describe("lane-board lane controls", () => {
  it("wires lane up/down controls and close-removes-lane-with-traces", () => {
    const signalListSource = fs.readFileSync(path.resolve("src/webview/components/SignalList.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("src/webview/main.ts"), "utf8");

    expect(signalListSource).toContain('moveUpButton.textContent = "Up";');
    expect(signalListSource).toContain('moveDownButton.textContent = "Down";');
    expect(signalListSource).toContain('closeButton.textContent = "Close";');
    expect(signalListSource).toContain("props.onReorderLane({");
    expect(signalListSource).toContain("props.onRemoveLane({");
    expect(mainSource).toContain('createProtocolEnvelope("webview/intent/reorderAxis"');
    expect(mainSource).toContain('createProtocolEnvelope("webview/intent/removeAxisAndTraces"');
    expect(mainSource).toContain('createProtocolEnvelope("webview/intent/setTraceVisible"');
    expect(mainSource).toContain('createProtocolEnvelope("webview/intent/removeTrace"');
  });
});

describe("T-041 plot tab lifecycle host intents", () => {
  it("wires tab add/select/remove actions to host intents from webview", () => {
    const source = fs.readFileSync(path.resolve("src/webview/main.ts"), "utf8");
    const htmlSource = fs.readFileSync(path.resolve("src/webview/index.html"), "utf8");

    expect(source).toContain('createProtocolEnvelope("webview/intent/setActivePlot"');
    expect(source).toContain('createProtocolEnvelope("webview/intent/addPlot"');
    expect(source).toContain('createProtocolEnvelope("webview/intent/removePlot"');
    expect(source).toContain('createProtocolEnvelope("webview/intent/clearPlot"');
    expect(source).toContain("onSelect: (plotId) => postSetActivePlot(plotId)");
    expect(source).toContain("onAdd: () => postAddPlot(activePlot.xSignal)");
    expect(source).toContain("onRemove: (plotId) => postRemovePlot(plotId)");
    expect(source).toContain("getRequiredElement<HTMLButtonElement>(\"clear-plot-button\")");
    expect(source).toContain("Clear active plot?");
    expect(htmlSource).toContain('id="clear-plot-button"');
    expect(source).not.toContain('onAdd: () =>\n      dispatch({\n        type: "plot/add"');
    expect(source).not.toContain('onRemove: (plotId) => dispatch({ type: "plot/remove", payload: { plotId } })');
  });
});

describe("T-042 multi-plot quick-add targeting", () => {
  it("routes quick-add drop intents using host-provided plot and lane target metadata", () => {
    const source = fs.readFileSync(path.resolve("src/webview/main.ts"), "utf8");

    expect(source).toContain("message.payload.plotId && message.payload.axisId");
    expect(source).toContain("plotId: message.payload.plotId");
  });

  it("keeps quick-add host fallback trace identity dataset-qualified", () => {
    const source = fs.readFileSync(path.resolve("src/extension.ts"), "utf8");

    expect(source).toContain("sourceId: toTraceSourceId(selection.documentPath, selection.signal)");
  });

  it("ensures no-active-viewer side-panel commands auto-open a viewer target before dispatch", () => {
    const source = fs.readFileSync(path.resolve("src/extension.ts"), "utf8");

    expect(source).toContain("if (!viewerSessions.resolveTargetViewerSession(selection.documentPath)) {");
    expect(source).toContain("await ensureViewerTargetForDataset(selection.documentPath);");
    expect(source).toContain('runSidePanelSignalAction("add-to-plot")');
    expect(source).toContain('runSidePanelSignalAction("add-to-new-axis")');
  });
});

describe("T-043 plot rename host intent", () => {
  it("routes tab rename through host intent posting and removes local-only rename dispatch", () => {
    const source = fs.readFileSync(path.resolve("src/webview/main.ts"), "utf8");

    expect(source).toContain('createProtocolEnvelope("webview/intent/renamePlot"');
    expect(source).toContain("onRename: (plotId) =>");
    expect(source).toContain("postRenamePlot(plotId, nextName)");
    expect(source).not.toContain('dispatch({ type: "plot/rename"');
  });
});
