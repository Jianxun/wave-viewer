import * as path from "node:path";

import { exportPlotSpecV1 } from "../core/spec/exportSpec";
import { importPlotSpecV1 } from "../core/spec/importSpec";
import { createProtocolEnvelope, parseWebviewToHostMessage, type Dataset } from "../core/dataset/types";
import { createWorkspaceState, type WorkspaceState } from "../webview/state/workspaceState";
import { applyDropSignalAction } from "./workspaceActions";
import {
  createSidePanelTraceInjectedPayload,
  createViewerBindingUpdatedPayload,
  getAddedTraces,
  hydrateWorkspaceReplayPayload,
  toTraceSourceId
} from "./sidePanel";
import type {
  CommandDeps,
  ExportSpecCommandDeps,
  ImportSpecCommandDeps,
  LoadCsvFilesCommandDeps,
  ReloadAllLoadedFilesCommandDeps,
  RemoveLoadedFileCommandDeps
} from "./types";
import { resolveDatasetPathFromCommandArgument } from "./signalTree";

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

      if (message.type === "webview/intent/dropSignal") {
        if (!datasetPath || !normalizedDataset) {
          deps.logDebug?.("Ignored dropSignal because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }

        let previousWorkspace: WorkspaceState;
        let nextWorkspace: WorkspaceState;
        let revision: number;
        let viewerState: { activePlotId: string; activeAxisByPlotId: Record<string, `y${number}`> };
        const patchReason = `dropSignal:${message.payload.source}`;
        try {
          const requestedAxisId =
            message.payload.target.kind === "axis" && isAxisId(message.payload.target.axisId)
              ? message.payload.target.axisId
              : undefined;
          const transaction = deps.commitHostStateTransaction({
            datasetPath,
            defaultXSignal: normalizedDataset.defaultXSignal,
            reason: patchReason,
            mutate: (workspace) =>
              applyDropSignalAction(workspace, message.payload, {
                sourceId: toTraceSourceId(datasetPath, message.payload.signal)
              }),
            selectActiveAxis: ({ previous, nextWorkspace }) => {
              if (requestedAxisId) {
                return { plotId: message.payload.plotId, axisId: requestedAxisId };
              }
              const newAxisId = findNewAxisId(previous.workspace, nextWorkspace, message.payload.plotId);
              if (!newAxisId) {
                return undefined;
              }
              return { plotId: message.payload.plotId, axisId: newAxisId };
            }
          });
          previousWorkspace = transaction.previous.workspace;
          nextWorkspace = transaction.next.workspace;
          revision = transaction.next.revision;
          viewerState = transaction.next.viewerState;
        } catch (error) {
          deps.logDebug?.("Ignored invalid webview dropSignal message payload.", {
            payload: message.payload,
            error: getErrorMessage(error)
          });
          return;
        }

        const tuples = getAddedTraces(previousWorkspace, nextWorkspace).map((trace) =>
          createSidePanelTraceInjectedPayload(viewerId, datasetPath, normalizedDataset, trace.signal, {
            traceId: trace.id,
            sourceId: trace.sourceId
          }).trace
        );
        if (tuples.length > 0) {
          void panel.webview.postMessage(
            createProtocolEnvelope("host/tupleUpsert", {
              tuples
            })
          );
        }
        void panel.webview.postMessage(
          createProtocolEnvelope("host/statePatch", {
            revision,
            workspace: nextWorkspace,
            viewerState,
            reason: patchReason
          })
        );
        return;
      }

      if (message.type === "webview/intent/setActiveAxis") {
        if (!datasetPath || !normalizedDataset) {
          deps.logDebug?.("Ignored setActiveAxis because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }

        if (!isAxisId(message.payload.axisId)) {
          deps.logDebug?.("Ignored invalid webview setActiveAxis message payload.", {
            payload: message.payload,
            error: `Invalid axis id: ${message.payload.axisId}`
          });
          return;
        }

        const transaction = deps.commitHostStateTransaction({
          datasetPath,
          defaultXSignal: normalizedDataset.defaultXSignal,
          reason: "setActiveAxis:lane-click",
          mutate: (workspace) => workspace,
          selectActiveAxis: () => ({
            plotId: message.payload.plotId,
            axisId: message.payload.axisId
          })
        });

        void panel.webview.postMessage(
          createProtocolEnvelope("host/statePatch", {
            revision: transaction.next.revision,
            workspace: transaction.next.workspace,
            viewerState: transaction.next.viewerState,
            reason: transaction.reason
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
          createViewerBindingUpdatedPayload(viewerId)
        )
      );

      if (!datasetPath || !normalizedDataset) {
        return;
      }

      const cachedWorkspace = deps.getCachedWorkspace?.(datasetPath);
      if (cachedWorkspace) {
        const hydratedReplay = hydrateWorkspaceReplayPayload(
          viewerId,
          datasetPath,
          normalizedDataset,
          cachedWorkspace,
          deps.logDebug
        );
        if (hydratedReplay.workspace !== cachedWorkspace) {
          deps.setCachedWorkspace?.(datasetPath, hydratedReplay.workspace);
        }
        for (const tracePayload of hydratedReplay.tracePayloads) {
          void panel.webview.postMessage(
            createProtocolEnvelope("host/tupleUpsert", {
              tuples: [tracePayload]
            })
          );
        }
        const snapshot = deps.getHostStateSnapshot?.(datasetPath);
        const revision = snapshot?.revision ?? 0;
        const viewerState = snapshot?.viewerState ?? deriveViewerState(hydratedReplay.workspace);
        void panel.webview.postMessage(
          createProtocolEnvelope("host/stateSnapshot", {
            revision,
            workspace: hydratedReplay.workspace,
            viewerState
          })
        );
      }
    });
  };
}

function findNewAxisId(
  previousWorkspace: WorkspaceState,
  nextWorkspace: WorkspaceState,
  plotId: string
): `y${number}` | undefined {
  const previousAxisIds = new Set(
    previousWorkspace.plots.find((plot) => plot.id === plotId)?.axes.map((axis) => axis.id) ?? []
  );
  return nextWorkspace.plots
    .find((plot) => plot.id === plotId)
    ?.axes.find((axis) => !previousAxisIds.has(axis.id))?.id;
}

function isAxisId(value: string): value is `y${number}` {
  return /^y\d+$/.test(value);
}

function deriveViewerState(workspace: WorkspaceState): {
  activePlotId: string;
  activeAxisByPlotId: Record<string, `y${number}`>;
} {
  const activeAxisByPlotId: Record<string, `y${number}`> = {};
  for (const plot of workspace.plots) {
    const firstAxis = plot.axes[0]?.id;
    if (firstAxis) {
      activeAxisByPlotId[plot.id] = firstAxis;
    }
  }
  return {
    activePlotId: workspace.activePlotId,
    activeAxisByPlotId
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

    if (!isSameDatasetReference(parsed.datasetPath, activeDocument.uri.fsPath)) {
      deps.showError(
        `Wave Viewer reference-only spec points to '${parsed.datasetPath}', but the active CSV is '${activeDocument.uri.fsPath}'. Open the referenced CSV or re-export the spec from the current file.`
      );
      return;
    }

    deps.setCachedWorkspace(activeDocument.uri.fsPath, parsed.workspace);
    deps.showInformation(`Wave Viewer spec imported from ${specPath}`);
  };
}

function isSameDatasetReference(leftPath: string, rightPath: string): boolean {
  return path.resolve(leftPath) === path.resolve(rightPath);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Failed to load CSV dataset.";
}
