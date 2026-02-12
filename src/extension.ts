import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type * as VSCode from "vscode";

import type { Dataset } from "./core/dataset/types";
import { exportPlotSpecV1 } from "./core/spec/exportSpec";
import { parseCsv } from "./core/csv/parseCsv";
import { selectDefaultX } from "./core/dataset/selectDefaultX";
import {
  createDoubleClickQuickAddResolver,
  createSignalTreeDragAndDropController,
  createSignalTreeDataProvider,
  LOAD_CSV_FILES_COMMAND,
  REMOVE_LOADED_FILE_COMMAND,
  RELOAD_ALL_FILES_COMMAND,
  SIGNAL_BROWSER_ADD_TO_NEW_AXIS_COMMAND,
  SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND,
  SIGNAL_BROWSER_QUICK_ADD_COMMAND,
  SIGNAL_BROWSER_VIEW_ID,
  REVEAL_SIGNAL_IN_PLOT_COMMAND,
  resolveSignalFromCommandArgument
} from "./extension/signalTree";
import {
  createNoTargetViewerWarning,
  resolveSidePanelSelection,
  runResolvedSidePanelQuickAdd,
  runResolvedSidePanelSignalAction
} from "./extension/sidePanel";
import { createHostStateStore } from "./extension/hostStateStore";
import {
  createExportSpecCommand,
  createImportSpecCommand,
  createLoadCsvFilesCommand,
  createOpenLayoutCommand,
  createOpenViewerCommand,
  createReloadAllLoadedFilesCommand,
  createRemoveLoadedFileCommand,
  createSaveLayoutAsCommand,
  createSaveLayoutCommand,
  isCsvFile
} from "./extension/commands";
import { buildWebviewHtml } from "./extension/webviewHtml";
import { createViewerSessionRegistry } from "./extension/viewerSessions";
import {
  applyDropSignalAction,
  applySetTraceAxisAction,
  applySidePanelSignalAction
} from "./extension/workspaceActions";
import type { WorkspaceState } from "./webview/state/workspaceState";
import type {
  LayoutAutosaveController,
  LayoutAutosaveControllerDeps,
  LayoutAutosavePersistInput,
  LayoutAutosaveSnapshot,
  LayoutSelfWriteMetadata,
  LoadedDatasetRecord,
  WebviewPanelLike
} from "./extension/types";

export const OPEN_VIEWER_COMMAND = "waveViewer.openViewer";
export const OPEN_LAYOUT_COMMAND = "waveViewer.openLayout";
export const SAVE_LAYOUT_COMMAND = "waveViewer.saveLayout";
export const SAVE_LAYOUT_AS_COMMAND = "waveViewer.saveLayoutAs";
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

export {
  applyDropSignalAction,
  applySetTraceAxisAction,
  applySidePanelSignalAction,
  buildWebviewHtml,
  createHostStateStore,
  createExportSpecCommand,
  createImportSpecCommand,
  createLoadCsvFilesCommand,
  createOpenLayoutCommand,
  createNoTargetViewerWarning,
  createOpenViewerCommand,
  createReloadAllLoadedFilesCommand,
  createRemoveLoadedFileCommand,
  createSaveLayoutAsCommand,
  createSaveLayoutCommand,
  createViewerSessionRegistry,
  isCsvFile,
  resolveSidePanelSelection,
  runResolvedSidePanelQuickAdd,
  runResolvedSidePanelSignalAction
};

export type {
  CommandDeps,
  HostToWebviewMessage,
  LayoutAutosaveController,
  LayoutAutosaveControllerDeps,
  LayoutAutosavePersistInput,
  LayoutAutosaveSnapshot,
  LayoutSelfWriteMetadata,
  LoadedDatasetRecord,
  SidePanelSignalAction,
  ViewerSessionRegistry,
  WebviewLike,
  WebviewPanelLike
} from "./extension/types";

const DEFAULT_LAYOUT_AUTOSAVE_DEBOUNCE_MS = 200;

export function toDeterministicLayoutYaml(datasetPath: string, workspace: WorkspaceState): string {
  const yamlText = exportPlotSpecV1({ datasetPath, workspace });
  return yamlText.endsWith("\n") ? yamlText : `${yamlText}\n`;
}

export function writeLayoutFileAtomically(
  layoutUri: string,
  yamlText: string,
  revision = 0
): LayoutSelfWriteMetadata {
  const normalizedYamlText = yamlText.endsWith("\n") ? yamlText : `${yamlText}\n`;
  const nonce = randomUUID();
  const tempUri = `${layoutUri}.tmp-${process.pid}-${nonce}`;
  fs.writeFileSync(tempUri, normalizedYamlText, "utf8");
  try {
    fs.renameSync(tempUri, layoutUri);
  } catch (error) {
    try {
      fs.unlinkSync(tempUri);
    } catch {
      // Ignore cleanup failures because the original write error is primary.
    }
    throw error;
  }
  const stats = fs.statSync(layoutUri);
  return {
    layoutUri,
    tempUri,
    nonce,
    revision,
    writtenAtMs: Date.now(),
    mtimeMs: stats.mtimeMs,
    sizeBytes: stats.size,
    contentHash: createHash("sha256").update(normalizedYamlText).digest("hex")
  };
}

export function createLayoutAutosaveController(
  deps: LayoutAutosaveControllerDeps
): LayoutAutosaveController {
  const debounceMs = deps.debounceMs ?? DEFAULT_LAYOUT_AUTOSAVE_DEBOUNCE_MS;
  const pendingByDatasetPath = new Map<
    string,
    {
      timer: ReturnType<typeof setTimeout>;
      payload: LayoutAutosavePersistInput;
    }
  >();
  const lastSelfWriteByLayoutUri = new Map<string, LayoutSelfWriteMetadata>();

  const flushDatasetPath = (datasetPath: string): void => {
    const pending = pendingByDatasetPath.get(datasetPath);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    pendingByDatasetPath.delete(datasetPath);
    const metadata = deps.persistLayout(pending.payload);
    lastSelfWriteByLayoutUri.set(metadata.layoutUri, metadata);
  };

  return {
    schedule(snapshot) {
      const binding = deps.resolveLayoutBinding(snapshot.datasetPath);
      if (!binding) {
        deps.logDebug?.("Skipped layout autosave because no bound layout was resolved.", {
          datasetPath: snapshot.datasetPath,
          revision: snapshot.revision
        });
        return;
      }

      const existingPending = pendingByDatasetPath.get(snapshot.datasetPath);
      if (existingPending) {
        clearTimeout(existingPending.timer);
      }
      const payload: LayoutAutosavePersistInput = {
        layoutUri: binding.layoutUri,
        datasetPath: snapshot.datasetPath,
        workspace: snapshot.workspace,
        revision: snapshot.revision
      };
      const timer = setTimeout(() => flushDatasetPath(snapshot.datasetPath), debounceMs);
      pendingByDatasetPath.set(snapshot.datasetPath, { timer, payload });
    },
    flush(datasetPath) {
      if (datasetPath) {
        flushDatasetPath(datasetPath);
        return;
      }
      for (const pathKey of Array.from(pendingByDatasetPath.keys())) {
        flushDatasetPath(pathKey);
      }
    },
    getLastSelfWriteMetadata(layoutUri) {
      return lastSelfWriteByLayoutUri.get(layoutUri);
    },
    dispose() {
      for (const pending of pendingByDatasetPath.values()) {
        clearTimeout(pending.timer);
      }
      pendingByDatasetPath.clear();
    }
  };
}

function loadVscode(): typeof VSCode {
  return require("vscode") as typeof VSCode;
}

export function activate(context: VSCode.ExtensionContext): void {
  const vscode = loadVscode();
  const hostStateStore = createHostStateStore();
  const viewerSessions = createViewerSessionRegistry();
  const layoutAutosave = createLayoutAutosaveController({
    resolveLayoutBinding: (datasetPath) => {
      const target = viewerSessions.resolveTargetViewerSession(datasetPath);
      if (!target || target.bindDataset) {
        return undefined;
      }
      const sessionContext = viewerSessions.getViewerSessionContext(target.viewerId);
      if (!sessionContext) {
        return undefined;
      }
      return { layoutUri: sessionContext.layoutUri };
    },
    persistLayout: (input) =>
      writeLayoutFileAtomically(
        input.layoutUri,
        toDeterministicLayoutYaml(input.datasetPath, input.workspace),
        input.revision
      ),
    logDebug: (message, details) => {
      console.debug(`[wave-viewer] ${message}`, details);
    }
  });
  const loadedDatasetByPath = new Map<string, LoadedDatasetRecord>();
  const removedDatasetPathSet = new Set<string>();
  const signalTreeProvider = createSignalTreeDataProvider(vscode);
  const resolveQuickAddDoubleClick = createDoubleClickQuickAddResolver();

  const commitHostStateTransaction = (
    transaction: Parameters<typeof hostStateStore.commitTransaction>[0]
  ) => {
    const result = hostStateStore.commitTransaction(transaction);
    layoutAutosave.schedule({
      datasetPath: transaction.datasetPath,
      workspace: result.next.workspace,
      revision: result.next.revision
    });
    return result;
  };

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

  function runSidePanelSignalAction(actionType: "add-to-plot" | "add-to-new-axis" | "reveal-in-plot"): (item?: unknown) => void {
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
        commitHostStateTransaction,
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
            if (target.bindDataset) {
              viewerSessions.bindViewerToDataset(target.viewerId, documentPath);
            }
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
      commitHostStateTransaction({
        datasetPath: selection.documentPath,
        defaultXSignal: selection.loadedDataset.defaultXSignal,
        reason: "sidePanel:quick-add",
        mutate: (workspace, viewerState) =>
          applySidePanelSignalAction(workspace, {
            type: "add-to-plot",
            signal: selection.signal
          }, {
            axisId: viewerState.activeAxisByPlotId[workspace.activePlotId]
          })
      });
      return;
    }

    const snapshot = hostStateStore.ensureSnapshot(
      selection.documentPath,
      selection.loadedDataset.defaultXSignal
    );
    const activePlotId = snapshot.viewerState.activePlotId;
    const activeAxisId = snapshot.viewerState.activeAxisByPlotId[activePlotId];

    runResolvedSidePanelQuickAdd({
      documentPath: selection.documentPath,
      loadedDataset: selection.loadedDataset,
      signal: selection.signal,
      quickAddTarget:
        activeAxisId === undefined
          ? undefined
          : {
              plotId: activePlotId,
              axisId: activeAxisId
            },
      targetViewer,
      bindViewerToDataset: (viewerId, datasetPath) => {
        viewerSessions.bindViewerToDataset(viewerId, datasetPath);
      },
      showError: (message) => {
        void vscode.window.showErrorMessage(message);
      }
    });
  };

  const loadDataset = (documentPath: string): { dataset: Dataset; defaultXSignal: string } => {
    const csvText = fs.readFileSync(documentPath, "utf8");
    const dataset = parseCsv({ path: documentPath, csvText });
    const defaultXSignal = selectDefaultX(dataset);
    return { dataset, defaultXSignal };
  };

  const command = createOpenViewerCommand({
    extensionUri: context.extensionUri,
    getActiveDocument: () => vscode.window.activeTextEditor?.document,
    getPreferredDatasetPath: getMostRecentlyLoadedDatasetPath,
    loadDataset,
    onDatasetLoaded: (documentPath, loaded) => {
      registerLoadedDataset(documentPath, loaded);
    },
    resolveViewerSessionContext: (viewerId) => viewerSessions.getViewerSessionContext(viewerId),
    getCachedWorkspace: (documentPath) => hostStateStore.getWorkspace(documentPath),
    setCachedWorkspace: (documentPath, workspace) => {
      hostStateStore.setWorkspace(documentPath, workspace);
    },
    getHostStateSnapshot: (documentPath) => hostStateStore.getSnapshot(documentPath),
    ensureHostStateSnapshot: (documentPath, defaultXSignal) =>
      hostStateStore.ensureSnapshot(documentPath, defaultXSignal),
    commitHostStateTransaction,
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
    loadDataset,
    getCachedWorkspace: (documentPath) => hostStateStore.getWorkspace(documentPath),
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
    loadDataset,
    setCachedWorkspace: (documentPath, workspace) => {
      hostStateStore.setWorkspace(documentPath, workspace);
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

  const openLayoutCommand = createOpenLayoutCommand({
    getActiveViewerId: () => viewerSessions.getActiveViewerId(),
    showOpenDialog: async () => {
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { YAML: ["yaml", "yml"] }
      });
      return result?.[0]?.fsPath;
    },
    readTextFile: (filePath) => fs.readFileSync(filePath, "utf8"),
    loadDataset,
    setCachedWorkspace: (documentPath, workspace) => {
      return hostStateStore.setWorkspace(documentPath, workspace);
    },
    bindViewerToLayout: (viewerId, layoutUri, datasetPath) => {
      viewerSessions.bindViewerToLayout(viewerId, layoutUri, datasetPath);
    },
    getPanelForViewer: (viewerId) => viewerSessions.getPanelForViewer(viewerId),
    logDebug: (message, details) => {
      console.debug(`[wave-viewer] ${message}`, details);
    },
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    showInformation: (message) => {
      void vscode.window.showInformationMessage(message);
    }
  });

  const saveLayoutCommand = createSaveLayoutCommand({
    getActiveViewerId: () => viewerSessions.getActiveViewerId(),
    resolveViewerSessionContext: (viewerId) => viewerSessions.getViewerSessionContext(viewerId),
    loadDataset,
    getCachedWorkspace: (documentPath) => hostStateStore.getWorkspace(documentPath),
    writeTextFile: (filePath, text) => {
      writeLayoutFileAtomically(filePath, text);
    },
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    showInformation: (message) => {
      void vscode.window.showInformationMessage(message);
    }
  });

  const saveLayoutAsCommand = createSaveLayoutAsCommand({
    getActiveViewerId: () => viewerSessions.getActiveViewerId(),
    resolveViewerSessionContext: (viewerId) => viewerSessions.getViewerSessionContext(viewerId),
    loadDataset,
    getCachedWorkspace: (documentPath) => hostStateStore.getWorkspace(documentPath),
    showSaveDialog: async (defaultPath) => {
      const defaultUri = vscode.Uri.file(defaultPath);
      const result = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { YAML: ["yaml", "yml"] }
      });
      return result?.fsPath;
    },
    writeTextFile: (filePath, text) => {
      writeLayoutFileAtomically(filePath, text);
    },
    bindViewerToLayout: (viewerId, layoutUri, datasetPath) => {
      viewerSessions.bindViewerToLayout(viewerId, layoutUri, datasetPath);
    },
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    showInformation: (message) => {
      void vscode.window.showInformationMessage(message);
    }
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
    loadDataset,
    registerLoadedDataset,
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    }
  });

  const reloadAllLoadedFilesCommand = createReloadAllLoadedFilesCommand({
    getLoadedDatasetPaths: () => Array.from(loadedDatasetByPath.keys()),
    loadDataset,
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

  context.subscriptions.push({ dispose: () => layoutAutosave.dispose() });
  context.subscriptions.push(signalTreeView);
  context.subscriptions.push(vscode.commands.registerCommand(OPEN_VIEWER_COMMAND, command));
  context.subscriptions.push(vscode.commands.registerCommand(OPEN_LAYOUT_COMMAND, openLayoutCommand));
  context.subscriptions.push(vscode.commands.registerCommand(SAVE_LAYOUT_COMMAND, saveLayoutCommand));
  context.subscriptions.push(
    vscode.commands.registerCommand(SAVE_LAYOUT_AS_COMMAND, saveLayoutAsCommand)
  );
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
