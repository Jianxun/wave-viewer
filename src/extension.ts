import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type * as VSCode from "vscode";

import {
  COMPLEX_SIGNAL_ACCESSORS,
  createProtocolEnvelope,
  type Dataset
} from "./core/dataset/types";
import { exportPlotSpecV1 } from "./core/spec/exportSpec";
import { importPlotSpecV1 } from "./core/spec/importSpec";
import { parseCsv } from "./core/csv/parseCsv";
import { selectDefaultX } from "./core/dataset/selectDefaultX";
import {
  isHdf5DatasetFile,
  loadNormalizedHdf5Dataset
} from "./core/hdf5/loadNormalizedHdf5";
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
  resolveSignalFromCommandArgument
} from "./extension/signalTree";
import {
  createNoTargetViewerWarning,
  hydrateWorkspaceReplayPayload,
  resolveSidePanelSelection,
  runResolvedSidePanelQuickAdd,
  runResolvedSidePanelSignalAction,
  toTraceSourceId
} from "./extension/sidePanel";
import { createHostStateStore } from "./extension/hostStateStore";
import {
  createClearLayoutCommand,
  createExportFrozenBundleCommand,
  createExportSpecCommand,
  createImportSpecCommand,
  createLoadCsvFilesCommand,
  createOpenLayoutCommand,
  createOpenViewerCommand,
  createReloadAllLoadedFilesCommand,
  createRemoveLoadedFileCommand,
  createSaveLayoutAsCommand,
  createSaveLayoutCommand,
  isSupportedDatasetFile,
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
  LayoutAxisLaneIdMap,
  LayoutPlotXDatasetPathMap,
  LayoutAutosaveController,
  LayoutAutosaveControllerDeps,
  LayoutAutosavePersistInput,
  LayoutAutosaveSnapshot,
  HostToWebviewMessage,
  LayoutBindingTarget,
  LayoutExternalEditController,
  LayoutExternalEditControllerDeps,
  LayoutSelfWriteMetadata,
  LoadedDatasetRecord,
  WebviewPanelLike
} from "./extension/types";

export const OPEN_VIEWER_COMMAND = "waveViewer.openViewer";
export const OPEN_LAYOUT_COMMAND = "waveViewer.openLayout";
export const SAVE_LAYOUT_AS_COMMAND = "waveViewer.saveLayoutAs";
export const CLEAR_LAYOUT_COMMAND = "waveViewer.clearLayout";
export const EXPORT_FROZEN_BUNDLE_COMMAND = "waveViewer.exportFrozenBundle";
export {
  LOAD_CSV_FILES_COMMAND,
  REMOVE_LOADED_FILE_COMMAND,
  RELOAD_ALL_FILES_COMMAND,
  SIGNAL_BROWSER_ADD_TO_NEW_AXIS_COMMAND,
  SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND,
  SIGNAL_BROWSER_QUICK_ADD_COMMAND
};

export {
  applyDropSignalAction,
  applySetTraceAxisAction,
  buildDeterministicDatasetLookup,
  applySidePanelSignalAction,
  buildWebviewHtml,
  createExportSpecCommand,
  createClearLayoutCommand,
  createHostStateStore,
  createExportFrozenBundleCommand,
  createImportSpecCommand,
  createLoadCsvFilesCommand,
  createOpenLayoutCommand,
  createNoTargetViewerWarning,
  createOpenViewerCommand,
  createReloadAllLoadedFilesCommand,
  createRemoveLoadedFileCommand,
  createSaveLayoutAsCommand,
  createSaveLayoutCommand,
  isSupportedDatasetFile,
  createViewerSessionRegistry,
  isCsvFile,
  resolveLoadedDatasetDeterministically,
  resolveSidePanelSelection,
  runResolvedSidePanelQuickAdd,
  runResolvedSidePanelSignalAction,
  toDeterministicDatasetPathKeys
};

export type {
  CommandDeps,
  HostToWebviewMessage,
  LayoutAutosaveController,
  LayoutAutosaveControllerDeps,
  LayoutAutosavePersistInput,
  LayoutAutosaveSnapshot,
  LayoutBindingTarget,
  LayoutExternalEditController,
  LayoutExternalEditControllerDeps,
  LayoutSelfWriteMetadata,
  LoadedDatasetRecord,
  SidePanelSignalAction,
  ViewerSessionRegistry,
  WebviewLike,
  WebviewPanelLike
} from "./extension/types";

const DEFAULT_LAYOUT_AUTOSAVE_DEBOUNCE_MS = 200;
const DEFAULT_LAYOUT_EXTERNAL_EDIT_DEBOUNCE_MS = 80;

export function computeLayoutWatchTransition(
  previousLayoutUri: string | undefined,
  nextLayoutUri: string | undefined
): { layoutUriToUnwatch?: string; shouldWatchNext: boolean } {
  if (previousLayoutUri === nextLayoutUri) {
    return { shouldWatchNext: false };
  }
  return {
    layoutUriToUnwatch: previousLayoutUri,
    shouldWatchNext: nextLayoutUri !== undefined
  };
}

export function toDeterministicLayoutYaml(
  datasetPath: string,
  workspace: WorkspaceState,
  layoutUri?: string,
  laneIdByAxisIdByPlotId?: LayoutAxisLaneIdMap,
  xDatasetPathByPlotId?: LayoutPlotXDatasetPathMap
): string {
  const yamlText = exportPlotSpecV1({
    datasetPath,
    workspace,
    specPath: layoutUri,
    laneIdByAxisIdByPlotId,
    xDatasetPathByPlotId
  });
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
        revision: snapshot.revision,
        laneIdByAxisIdByPlotId: binding.laneIdByAxisIdByPlotId,
        xDatasetPathByPlotId: binding.xDatasetPathByPlotId
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
    recordSelfWriteMetadata(metadata) {
      lastSelfWriteByLayoutUri.set(metadata.layoutUri, metadata);
    },
    dispose() {
      for (const pending of pendingByDatasetPath.values()) {
        clearTimeout(pending.timer);
      }
      pendingByDatasetPath.clear();
    }
  };
}

export function createLayoutExternalEditController(
  deps: LayoutExternalEditControllerDeps
): LayoutExternalEditController {
  const debounceMs = deps.debounceMs ?? DEFAULT_LAYOUT_EXTERNAL_EDIT_DEBOUNCE_MS;
  const watchersByLayoutUri = new Map<string, { handle: { dispose(): void }; refCount: number }>();
  const lastAppliedHashByLayoutUri = new Map<string, string>();
  const timersByLayoutUri = new Map<string, ReturnType<typeof setTimeout>>();
  const reloadingLayoutUris = new Set<string>();
  const pendingReloadLayoutUris = new Set<string>();

  const applyReload = (layoutUri: string): void => {
    const bindings = deps.resolveBindingsForLayout(layoutUri);
    if (bindings.length === 0) {
      deps.logDebug?.("Skipped layout external reload because no viewers are bound.", {
        layoutUri
      });
      return;
    }

    let yamlText: string;
    try {
      yamlText = deps.readTextFile(layoutUri);
    } catch (error) {
      deps.showError(
        `Wave Viewer layout reload failed for ${layoutUri}: ${getErrorMessage(error)}`
      );
      return;
    }

    const contentHash = createHash("sha256").update(yamlText).digest("hex");
    if (lastAppliedHashByLayoutUri.get(layoutUri) === contentHash) {
      deps.logDebug?.("Skipped layout external reload because content hash is unchanged.", {
        layoutUri
      });
      return;
    }

    const lastSelfWrite = deps.getLastSelfWriteMetadata(layoutUri);
    if (lastSelfWrite && contentHash === lastSelfWrite.contentHash) {
      const stats = deps.readFileStats(layoutUri);
      const matchesSelfWrite =
        stats !== undefined &&
        Math.abs(stats.mtimeMs - lastSelfWrite.mtimeMs) < 1 &&
        stats.sizeBytes === lastSelfWrite.sizeBytes;
      if (matchesSelfWrite) {
        lastAppliedHashByLayoutUri.set(layoutUri, contentHash);
        deps.logDebug?.("Suppressed layout external reload because change matches self write.", {
          layoutUri,
          revision: lastSelfWrite.revision
        });
        return;
      }
    }

    const uniqueByDatasetPath = new Map<string, LayoutBindingTarget>();
    for (const binding of bindings) {
      if (!uniqueByDatasetPath.has(binding.datasetPath)) {
        uniqueByDatasetPath.set(binding.datasetPath, binding);
      }
    }

    const patchByDatasetPath = new Map<
      string,
      {
        revision: number;
        workspace: WorkspaceState;
        tracePayloads: Extract<
          HostToWebviewMessage,
          { type: "host/tupleUpsert" }
        >["payload"]["tuples"];
        viewerState: { activePlotId: string; activeAxisByPlotId: Record<string, `y${number}`> };
      }
    >();

    for (const [datasetPath, hydrationBinding] of uniqueByDatasetPath.entries()) {
      try {
        const loaded = deps.loadDataset(datasetPath);
        const imported = importPlotSpecV1({
          yamlText,
          availableSignals: loaded.dataset.columns.map((column) => column.name),
          specPath: layoutUri
        });
        if (imported.datasetPath !== datasetPath) {
          throw new Error(
            `Wave Viewer reference-only spec points to '${imported.datasetPath}', but bound dataset is '${datasetPath}'.`
          );
        }
        const hydratedReplay = hydrateWorkspaceReplayPayload(
          hydrationBinding.viewerId,
          datasetPath,
          loaded,
          imported.workspace,
          deps.logDebug
        );
        const snapshot = deps.applyImportedWorkspace(datasetPath, hydratedReplay.workspace);
        deps.recordLayoutAxisLaneIdMap?.(layoutUri, imported.laneIdByAxisIdByPlotId);
        deps.recordLayoutXDatasetPathMap?.(layoutUri, imported.xDatasetPathByPlotId);
        patchByDatasetPath.set(datasetPath, {
          revision: snapshot.revision,
          workspace: snapshot.workspace,
          tracePayloads: hydratedReplay.tracePayloads,
          viewerState: snapshot.viewerState
        });
      } catch (error) {
        deps.showError(
          `Wave Viewer layout reload failed for ${layoutUri}: ${getErrorMessage(error)}`
        );
        return;
      }
    }

    for (const binding of bindings) {
      const patch = patchByDatasetPath.get(binding.datasetPath);
      if (!patch) {
        continue;
      }
      if (patch.tracePayloads.length > 0) {
        void binding.panel.webview.postMessage(
          createProtocolEnvelope("host/tupleUpsert", {
            tuples: patch.tracePayloads
          })
        );
      }
      void binding.panel.webview.postMessage(
        createProtocolEnvelope("host/statePatch", {
          revision: patch.revision,
          workspace: patch.workspace,
          viewerState: patch.viewerState,
          reason: "layoutExternalEdit:file-watch"
        })
      );
    }
    lastAppliedHashByLayoutUri.set(layoutUri, contentHash);
  };

  const runReload = (layoutUri: string): void => {
    if (reloadingLayoutUris.has(layoutUri)) {
      pendingReloadLayoutUris.add(layoutUri);
      return;
    }

    reloadingLayoutUris.add(layoutUri);
    try {
      applyReload(layoutUri);
    } finally {
      reloadingLayoutUris.delete(layoutUri);
      if (pendingReloadLayoutUris.has(layoutUri)) {
        pendingReloadLayoutUris.delete(layoutUri);
        runReload(layoutUri);
      }
    }
  };

  return {
    watchLayout(layoutUri) {
      const existing = watchersByLayoutUri.get(layoutUri);
      if (existing) {
        existing.refCount += 1;
        return;
      }
      const handle = deps.watchLayout(layoutUri, () => {
        const existingTimer = timersByLayoutUri.get(layoutUri);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }
        if (debounceMs <= 0) {
          timersByLayoutUri.delete(layoutUri);
          runReload(layoutUri);
          return;
        }
        const timer = setTimeout(() => {
          timersByLayoutUri.delete(layoutUri);
          runReload(layoutUri);
        }, debounceMs);
        timersByLayoutUri.set(layoutUri, timer);
      });
      watchersByLayoutUri.set(layoutUri, { handle, refCount: 1 });
    },
    unwatchLayout(layoutUri) {
      const watched = watchersByLayoutUri.get(layoutUri);
      if (!watched) {
        return;
      }
      watched.refCount -= 1;
      if (watched.refCount > 0) {
        return;
      }
      const existingTimer = timersByLayoutUri.get(layoutUri);
      if (existingTimer) {
        clearTimeout(existingTimer);
        timersByLayoutUri.delete(layoutUri);
      }
      watched.handle.dispose();
      watchersByLayoutUri.delete(layoutUri);
      reloadingLayoutUris.delete(layoutUri);
      pendingReloadLayoutUris.delete(layoutUri);
      lastAppliedHashByLayoutUri.delete(layoutUri);
    },
    reloadLayout(layoutUri) {
      runReload(layoutUri);
    },
    dispose() {
      for (const timer of timersByLayoutUri.values()) {
        clearTimeout(timer);
      }
      timersByLayoutUri.clear();
      for (const watcher of watchersByLayoutUri.values()) {
        watcher.handle.dispose();
      }
      watchersByLayoutUri.clear();
      reloadingLayoutUris.clear();
      pendingReloadLayoutUris.clear();
      lastAppliedHashByLayoutUri.clear();
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
  const layoutLaneIdsByLayoutUri = new Map<string, LayoutAxisLaneIdMap>();
  const layoutXDatasetPathByPlotIdByLayoutUri = new Map<string, LayoutPlotXDatasetPathMap>();
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
      return {
        layoutUri: sessionContext.layoutUri,
        laneIdByAxisIdByPlotId: layoutLaneIdsByLayoutUri.get(sessionContext.layoutUri),
        xDatasetPathByPlotId: layoutXDatasetPathByPlotIdByLayoutUri.get(sessionContext.layoutUri)
      };
    },
    persistLayout: (input) =>
      writeLayoutFileAtomically(
        input.layoutUri,
        toDeterministicLayoutYaml(
          input.datasetPath,
          input.workspace,
          input.layoutUri,
          input.laneIdByAxisIdByPlotId,
          input.xDatasetPathByPlotId
        ),
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
  const layoutByViewerId = new Map<string, string>();
  let forcedOpenViewerDatasetPath: string | undefined;

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
      signals: loaded.explorerSignals ?? loaded.dataset.columns.map((column) => column.name)
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

  const loadDataset = (documentPath: string): LoadedDatasetRecord => {
    if (isHdf5DatasetFile(documentPath)) {
      const loaded = loadNormalizedHdf5Dataset(documentPath);
      return {
        dataset: loaded.dataset,
        defaultXSignal: selectDefaultX(loaded.dataset),
        explorerSignals: loaded.signalPaths,
        signalAliasLookup: loaded.signalAliasLookup,
        complexSignalPaths: loaded.complexSignalPaths,
        complexSignalAccessors: COMPLEX_SIGNAL_ACCESSORS,
        resolveSignalValues: loaded.resolveSignalValues
      };
    }

    const dataset = parseCsv({ path: documentPath, csvText: fs.readFileSync(documentPath, "utf8") });
    return {
      dataset,
      defaultXSignal: selectDefaultX(dataset)
    };
  };

  const layoutExternalEdit = createLayoutExternalEditController({
    watchLayout: (layoutUri, onChange) => {
      const parentDirectory = path.dirname(layoutUri);
      const watchedName = path.basename(layoutUri);
      const watcher = fs.watch(parentDirectory, { persistent: false }, (_eventType, fileName) => {
        if (!fileName || fileName.toString() === watchedName) {
          onChange();
        }
      });
      return {
        dispose: () => {
          watcher.close();
        }
      };
    },
    readTextFile: (layoutUri) => fs.readFileSync(layoutUri, "utf8"),
    readFileStats: (layoutUri) => {
      try {
        const stats = fs.statSync(layoutUri);
        return { mtimeMs: stats.mtimeMs, sizeBytes: stats.size };
      } catch {
        return undefined;
      }
    },
    resolveBindingsForLayout: (layoutUri) => viewerSessions.getViewerBindingsForLayout(layoutUri),
    loadDataset,
    applyImportedWorkspace: (datasetPath, workspace) =>
      hostStateStore.setWorkspace(datasetPath, workspace),
    recordLayoutAxisLaneIdMap: (layoutUri, mapping) => {
      layoutLaneIdsByLayoutUri.set(layoutUri, mapping);
    },
    recordLayoutXDatasetPathMap: (layoutUri, mapping) => {
      layoutXDatasetPathByPlotIdByLayoutUri.set(layoutUri, mapping);
    },
    getLastSelfWriteMetadata: (layoutUri) => layoutAutosave.getLastSelfWriteMetadata(layoutUri),
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    logDebug: (message, details) => {
      console.debug(`[wave-viewer] ${message}`, details);
    }
  });

  const bindViewerToDataset = (viewerId: string, datasetPath: string): void => {
    const previousLayoutUri = layoutByViewerId.get(viewerId);
    viewerSessions.bindViewerToDataset(viewerId, datasetPath);
    const contextForViewer = viewerSessions.getViewerSessionContext(viewerId);
    const nextLayoutUri = contextForViewer?.layoutUri;
    const transition = computeLayoutWatchTransition(previousLayoutUri, nextLayoutUri);
    if (transition.layoutUriToUnwatch) {
      layoutExternalEdit.unwatchLayout(transition.layoutUriToUnwatch);
    }
    if (!contextForViewer) {
      layoutByViewerId.delete(viewerId);
      return;
    }
    layoutByViewerId.set(viewerId, contextForViewer.layoutUri);
    if (transition.shouldWatchNext) {
      layoutExternalEdit.watchLayout(contextForViewer.layoutUri);
    }
  };

  const bindViewerToLayout = (viewerId: string, layoutUri: string, datasetPath: string): void => {
    const previousLayoutUri = layoutByViewerId.get(viewerId);
    viewerSessions.bindViewerToLayout(viewerId, layoutUri, datasetPath);
    const transition = computeLayoutWatchTransition(previousLayoutUri, layoutUri);
    if (transition.layoutUriToUnwatch) {
      layoutExternalEdit.unwatchLayout(transition.layoutUriToUnwatch);
    }
    layoutByViewerId.set(viewerId, layoutUri);
    if (transition.shouldWatchNext) {
      layoutExternalEdit.watchLayout(layoutUri);
    }
  };

  const registerPanelSession = (documentPath: string | undefined, panel: WebviewPanelLike): string => {
    const viewerId = viewerSessions.registerPanel(panel, documentPath);
    const contextForViewer = viewerSessions.getViewerSessionContext(viewerId);
    if (contextForViewer) {
      layoutByViewerId.set(viewerId, contextForViewer.layoutUri);
      layoutExternalEdit.watchLayout(contextForViewer.layoutUri);
    }
    panel.onDidDispose?.(() => {
      const boundLayoutUri = layoutByViewerId.get(viewerId);
      if (!boundLayoutUri) {
        return;
      }
      layoutByViewerId.delete(viewerId);
      layoutExternalEdit.unwatchLayout(boundLayoutUri);
    });
    return viewerId;
  };

  const persistLayoutFile = (layoutUri: string, yamlText: string, revision = 0): void => {
    const metadata = writeLayoutFileAtomically(layoutUri, yamlText, revision);
    layoutAutosave.recordSelfWriteMetadata(metadata);
  };

  function runSidePanelSignalAction(
    actionType: "add-to-plot" | "add-to-new-axis" | "reveal-in-plot"
  ): (item?: unknown) => Promise<void> {
    return async (item?: unknown) => {
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

      if (!viewerSessions.resolveTargetViewerSession(selection.documentPath)) {
        await ensureViewerTargetForDataset(selection.documentPath);
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
              bindViewerToDataset(target.viewerId, documentPath);
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
            sourceId: toTraceSourceId(selection.documentPath, selection.signal),
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
        bindViewerToDataset(viewerId, datasetPath);
      },
      showError: (message) => {
        void vscode.window.showErrorMessage(message);
      }
    });
  };

  let reloadAllLoadedFilesCommand: (() => Promise<void>) | undefined;

  const command = createOpenViewerCommand({
    extensionUri: context.extensionUri,
    getActiveDocument: () => vscode.window.activeTextEditor?.document,
    getPreferredDatasetPath: () => forcedOpenViewerDatasetPath ?? getMostRecentlyLoadedDatasetPath(),
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
    refreshAllLoadedSignals: async () => {
      await reloadAllLoadedFilesCommand?.();
    },
    createPanel: () =>
      vscode.window.createWebviewPanel("waveViewer.main", "Wave Viewer", vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true
      }) as unknown as WebviewPanelLike,
    onPanelCreated: (documentPath, panel) => registerPanelSession(documentPath, panel),
    showWarning: (message) => vscode.window.showWarningMessage(message, { modal: true }, "Clear Plot"),
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    logDebug: (message, details) => {
      console.debug(`[wave-viewer] ${message}`, details);
    },
    buildHtml: (webview, extensionUriArg) =>
      buildWebviewHtml(webview as unknown as VSCode.Webview, extensionUriArg as VSCode.Uri)
  });

  async function ensureViewerTargetForDataset(datasetPath: string): Promise<string | undefined> {
    const existing = viewerSessions.resolveTargetViewerSession(datasetPath);
    if (existing) {
      if (existing.bindDataset) {
        bindViewerToDataset(existing.viewerId, datasetPath);
      }
      return existing.viewerId;
    }

    const previousForcedDatasetPath = forcedOpenViewerDatasetPath;
    forcedOpenViewerDatasetPath = datasetPath;
    try {
      await command();
    } finally {
      forcedOpenViewerDatasetPath = previousForcedDatasetPath;
    }

    const created = viewerSessions.resolveTargetViewerSession(datasetPath);
    if (!created) {
      return undefined;
    }
    if (created.bindDataset) {
      bindViewerToDataset(created.viewerId, datasetPath);
    }
    return created.viewerId;
  }

  const exportFrozenBundleCommand = createExportFrozenBundleCommand({
    getActiveViewerId: () => viewerSessions.getActiveViewerId(),
    resolveViewerSessionContext: (viewerId) => viewerSessions.getViewerSessionContext(viewerId),
    loadDataset,
    getCachedWorkspace: (documentPath) => hostStateStore.getWorkspace(documentPath),
    resolveLayoutAxisLaneIdMap: (layoutUri) => layoutLaneIdsByLayoutUri.get(layoutUri),
    resolveLayoutXDatasetPathMap: (layoutUri) =>
      layoutXDatasetPathByPlotIdByLayoutUri.get(layoutUri),
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
    },
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    showInformation: (message) => {
      void vscode.window.showInformationMessage(message);
    }
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
    ensureViewerForDataset: (datasetPath) => ensureViewerTargetForDataset(datasetPath),
    registerLoadedDataset,
    bindViewerToLayout,
    recordLayoutAxisLaneIdMap: (layoutUri, mapping) => {
      layoutLaneIdsByLayoutUri.set(layoutUri, mapping);
    },
    recordLayoutXDatasetPathMap: (layoutUri, mapping) => {
      layoutXDatasetPathByPlotIdByLayoutUri.set(layoutUri, mapping);
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

  const saveLayoutAsCommand = createSaveLayoutAsCommand({
    getActiveViewerId: () => viewerSessions.getActiveViewerId(),
    resolveViewerSessionContext: (viewerId) => viewerSessions.getViewerSessionContext(viewerId),
    loadDataset,
    getCachedWorkspace: (documentPath) => hostStateStore.getWorkspace(documentPath),
    resolveLayoutAxisLaneIdMap: (layoutUri) => layoutLaneIdsByLayoutUri.get(layoutUri),
    resolveLayoutXDatasetPathMap: (layoutUri) =>
      layoutXDatasetPathByPlotIdByLayoutUri.get(layoutUri),
    showSaveDialog: async (defaultPath) => {
      const defaultUri = vscode.Uri.file(defaultPath);
      const result = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { YAML: ["yaml", "yml"] }
      });
      return result?.fsPath;
    },
    writeTextFile: (filePath, text) => {
      persistLayoutFile(filePath, text);
    },
    bindViewerToLayout,
    recordLayoutAxisLaneIdMap: (layoutUri, mapping) => {
      layoutLaneIdsByLayoutUri.set(layoutUri, mapping);
    },
    recordLayoutXDatasetPathMap: (layoutUri, mapping) => {
      layoutXDatasetPathByPlotIdByLayoutUri.set(layoutUri, mapping);
    },
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    showInformation: (message) => {
      void vscode.window.showInformationMessage(message);
    }
  });

  const clearLayoutCommand = createClearLayoutCommand({
    getActiveViewerId: () => viewerSessions.getActiveViewerId(),
    resolveViewerSessionContext: (viewerId) => viewerSessions.getViewerSessionContext(viewerId),
    loadDataset,
    commitHostStateTransaction,
    getPanelForViewer: (viewerId) => viewerSessions.getPanelForViewer(viewerId),
    showWarning: (message) =>
      vscode.window.showWarningMessage(message, { modal: true }, "Clear Layout"),
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    }
  });

  const loadCsvFilesCommand = createLoadCsvFilesCommand({
    showOpenDialog: async () => {
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: true,
        filters: { Waveform: ["csv", "h5"] }
      });
      return result?.map((uri) => uri.fsPath);
    },
    loadDataset,
    registerLoadedDataset,
    fileExists: (filePath) => fs.existsSync(filePath),
    readTextFile: (filePath) => fs.readFileSync(filePath, "utf8"),
    writeTextFile: (filePath, text) => {
      persistLayoutFile(filePath, text);
    },
    setCachedWorkspace: (documentPath, workspace) => {
      return hostStateStore.setWorkspace(documentPath, workspace);
    },
    openViewerForDataset: (documentPath) => ensureViewerTargetForDataset(documentPath),
    bindViewerToLayout,
    recordLayoutAxisLaneIdMap: (layoutUri, mapping) => {
      layoutLaneIdsByLayoutUri.set(layoutUri, mapping);
    },
    recordLayoutXDatasetPathMap: (layoutUri, mapping) => {
      layoutXDatasetPathByPlotIdByLayoutUri.set(layoutUri, mapping);
    },
    showError: (message) => {
      void vscode.window.showErrorMessage(message);
    }
  });

  reloadAllLoadedFilesCommand = createReloadAllLoadedFilesCommand({
    getLoadedDatasetPaths: () => Array.from(loadedDatasetByPath.keys()),
    loadDataset,
    registerLoadedDataset,
    onReloadCompleted: async (reloadedDatasetPaths) => {
      if (reloadedDatasetPaths.length === 0) {
        return;
      }

      const datasetPathLookup = buildDeterministicDatasetLookup(loadedDatasetByPath);
      const bindings = viewerSessions.getAllViewerBindings();
      for (const binding of bindings) {
        const viewerSnapshot = hostStateStore.getSnapshot(binding.datasetPath);
        if (!viewerSnapshot) {
          continue;
        }

        const viewerBaseDataset = resolveLoadedDatasetDeterministically(
          binding.datasetPath,
          datasetPathLookup
        );
        if (!viewerBaseDataset) {
          continue;
        }
        const hydrated = hydrateWorkspaceReplayPayload(
          binding.viewerId,
          binding.datasetPath,
          viewerBaseDataset,
          viewerSnapshot.workspace,
          (message, details) => {
            console.debug(`[wave-viewer] ${message}`, details);
          },
          (datasetPath) => {
            return resolveLoadedDatasetDeterministically(datasetPath, datasetPathLookup);
          }
        );
        const nextSnapshot = hostStateStore.setWorkspace(
          binding.datasetPath,
          hydrated.workspace !== viewerSnapshot.workspace
            ? hydrated.workspace
            : viewerSnapshot.workspace
        );

        void binding.panel.webview.postMessage(
          createProtocolEnvelope("host/replaySnapshot", {
            revision: nextSnapshot.revision,
            workspace: nextSnapshot.workspace,
            viewerState: nextSnapshot.viewerState,
            tuples: hydrated.tracePayloads,
            reason: "reloadAllFiles:command"
          })
        );
      }
    },
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
  context.subscriptions.push({ dispose: () => layoutExternalEdit.dispose() });
  context.subscriptions.push(signalTreeView);
  context.subscriptions.push(vscode.commands.registerCommand(OPEN_VIEWER_COMMAND, command));
  context.subscriptions.push(vscode.commands.registerCommand(OPEN_LAYOUT_COMMAND, openLayoutCommand));
  context.subscriptions.push(
    vscode.commands.registerCommand(SAVE_LAYOUT_AS_COMMAND, saveLayoutAsCommand)
  );
  context.subscriptions.push(vscode.commands.registerCommand(CLEAR_LAYOUT_COMMAND, clearLayoutCommand));
  context.subscriptions.push(
    vscode.commands.registerCommand(EXPORT_FROZEN_BUNDLE_COMMAND, exportFrozenBundleCommand)
  );
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
  context.subscriptions.push(vscode.commands.registerCommand(LOAD_CSV_FILES_COMMAND, loadCsvFilesCommand));
  context.subscriptions.push(
    vscode.commands.registerCommand(RELOAD_ALL_FILES_COMMAND, reloadAllLoadedFilesCommand)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(REMOVE_LOADED_FILE_COMMAND, removeLoadedFileCommand)
  );
}

function toDeterministicDatasetPathKeys(datasetPath: string): string[] {
  const keys = new Set<string>();
  const resolvedPath = path.resolve(datasetPath);
  const normalizedPath = path.normalize(resolvedPath);
  const comparable = process.platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
  keys.add(comparable);

  const frozenPathMatch = comparable.match(/^(.*)\.frozen\.csv$/i);
  if (frozenPathMatch?.[1]) {
    keys.add(`${frozenPathMatch[1]}.csv`);
  }

  const csvPathMatch = comparable.match(/^(.*)\.csv$/i);
  if (csvPathMatch?.[1]) {
    keys.add(`${csvPathMatch[1]}.frozen.csv`);
  }

  return Array.from(keys);
}

function buildDeterministicDatasetLookup(
  loadedDatasetByPath: ReadonlyMap<string, LoadedDatasetRecord>
): ReadonlyMap<string, LoadedDatasetRecord> {
  const exactLookup = new Map<string, LoadedDatasetRecord>();
  const aliasLookup = new Map<string, LoadedDatasetRecord>();
  const entries = Array.from(loadedDatasetByPath.entries()).sort(([leftPath], [rightPath]) =>
    leftPath.localeCompare(rightPath)
  );

  for (const [datasetPath, loadedDataset] of entries) {
    const [exactKey, ...aliasKeys] = toDeterministicDatasetPathKeys(datasetPath);
    if (exactKey && !exactLookup.has(exactKey)) {
      exactLookup.set(exactKey, loadedDataset);
    }

    for (const aliasKey of aliasKeys) {
      if (!exactLookup.has(aliasKey) && !aliasLookup.has(aliasKey)) {
        aliasLookup.set(aliasKey, loadedDataset);
      }
    }
  }

  const lookup = new Map<string, LoadedDatasetRecord>();
  for (const [key, loadedDataset] of exactLookup.entries()) {
    lookup.set(key, loadedDataset);
  }
  for (const [key, loadedDataset] of aliasLookup.entries()) {
    if (!lookup.has(key)) {
      lookup.set(key, loadedDataset);
    }
  }
  return lookup;
}

function resolveLoadedDatasetDeterministically(
  datasetPath: string,
  datasetPathLookup: ReadonlyMap<string, LoadedDatasetRecord>
): LoadedDatasetRecord | undefined {
  for (const key of toDeterministicDatasetPathKeys(datasetPath)) {
    const match = datasetPathLookup.get(key);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown error.";
}

export function deactivate(): void {
  // No-op for MVP scaffold.
}
