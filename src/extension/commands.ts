import * as path from "node:path";

import { serializeDatasetToCsv } from "../core/csv/parseCsv";
import { collectExportPlotDatasets, exportPlotSpecV1 } from "../core/spec/exportSpec";
import {
  importPlotSpecV1,
  readPlotSpecDatasetPathV1,
  readPlotSpecDatasetsV1
} from "../core/spec/importSpec";
import {
  COMPLEX_SIGNAL_ACCESSORS,
  createProtocolEnvelope,
  parseComplexSignalReference,
  parseWebviewToHostMessage,
  type Dataset
} from "../core/dataset/types";
import { reduceWorkspaceState } from "../webview/state/reducer";
import { createWorkspaceState, type WorkspaceState } from "../webview/state/workspaceState";
import { applyDropSignalAction, applySetTraceAxisAction } from "./workspaceActions";
import {
  createSidePanelTraceInjectedPayload,
  createViewerBindingUpdatedPayload,
  getAddedTraces,
  hydrateWorkspaceReplayPayload,
  toTraceSourceId
} from "./sidePanel";
import type {
  ClearLayoutCommandDeps,
  CommandDeps,
  ExportSpecCommandDeps,
  ImportSpecCommandDeps,
  LayoutAxisLaneIdMap,
  LayoutPlotXDatasetPathMap,
  LoadCsvFilesCommandDeps,
  OpenLayoutCommandDeps,
  ReloadAllLoadedFilesCommandDeps,
  RemoveLoadedFileCommandDeps,
  SaveLayoutAsCommandDeps,
  SaveLayoutCommandDeps,
  ExportFrozenBundleCommandDeps,
  LoadedDatasetRecord
} from "./types";
import { resolveDatasetPathFromCommandArgument } from "./signalTree";

export function isCsvFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".csv");
}

export function isHdf5File(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".h5");
}

export function isSupportedDatasetFile(fileName: string): boolean {
  return isCsvFile(fileName) || isHdf5File(fileName);
}

export function createOpenViewerCommand(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const activeDocument = deps.getActiveDocument();
    const activeDatasetPath =
      activeDocument && isSupportedDatasetFile(activeDocument.fileName)
        ? activeDocument.uri.fsPath
        : undefined;
    const datasetPath = activeDatasetPath ?? deps.getPreferredDatasetPath?.();
    let normalizedDataset: LoadedDatasetRecord | undefined;

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

    const normalizedByDatasetPath = new Map<string, LoadedDatasetRecord>();
    if (datasetPath && normalizedDataset) {
      normalizedByDatasetPath.set(datasetPath, normalizedDataset);
    }

    const resolveDatasetContext = (
      requestedViewerId: string
    ): { datasetPath: string; normalizedDataset: LoadedDatasetRecord } | undefined => {
      const resolvedDatasetPath =
        deps.resolveViewerSessionContext?.(requestedViewerId)?.datasetPath ?? datasetPath;
      if (!resolvedDatasetPath) {
        return undefined;
      }

      const cached = normalizedByDatasetPath.get(resolvedDatasetPath);
      if (cached) {
        return { datasetPath: resolvedDatasetPath, normalizedDataset: cached };
      }

      try {
        const loaded = deps.loadDataset(resolvedDatasetPath);
        deps.onDatasetLoaded?.(resolvedDatasetPath, loaded);
        normalizedByDatasetPath.set(resolvedDatasetPath, loaded);
        return { datasetPath: resolvedDatasetPath, normalizedDataset: loaded };
      } catch (error) {
        deps.logDebug?.("Failed to resolve dataset context for viewer message.", {
          viewerId: requestedViewerId,
          datasetPath: resolvedDatasetPath,
          error: getErrorMessage(error)
        });
        return undefined;
      }
    };

    panel.webview.onDidReceiveMessage(async (rawMessage) => {
      const message = parseWebviewToHostMessage(rawMessage);
      if (!message) {
        deps.logDebug?.("Ignored invalid or unknown webview message.", rawMessage);
        return;
      }

      if (message.type === "webview/intent/dropSignal") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored dropSignal because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }
        const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

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
            datasetPath: resolvedDatasetPath,
            defaultXSignal: resolvedDataset.defaultXSignal,
            reason: patchReason,
            mutate: (workspace) =>
              applyDropSignalAction(workspace, message.payload, {
                sourceId: toTraceSourceId(resolvedDatasetPath, message.payload.signal)
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
          createSidePanelTraceInjectedPayload(
            viewerId,
            resolvedDatasetPath,
            resolvedDataset,
            trace.signal,
            {
              traceId: trace.id,
              sourceId: trace.sourceId
            }
          ).trace
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

      if (message.type === "webview/intent/setActivePlot") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored setActivePlot because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }
        const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

        try {
          const transaction = deps.commitHostStateTransaction({
            datasetPath: resolvedDatasetPath,
            defaultXSignal: resolvedDataset.defaultXSignal,
            reason: "setActivePlot:tab-select",
            mutate: (workspace) =>
              reduceWorkspaceState(workspace, {
                type: "plot/setActive",
                payload: { plotId: message.payload.plotId }
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
        } catch (error) {
          deps.logDebug?.("Ignored invalid webview setActivePlot message payload.", {
            payload: message.payload,
            error: getErrorMessage(error)
          });
        }
        return;
      }

      if (message.type === "webview/intent/addPlot") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored addPlot because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }
        const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

        const transaction = deps.commitHostStateTransaction({
          datasetPath: resolvedDatasetPath,
          defaultXSignal: resolvedDataset.defaultXSignal,
          reason: "addPlot:tab-add",
          mutate: (workspace) =>
            reduceWorkspaceState(workspace, {
              type: "plot/add",
              payload: { xSignal: message.payload.xSignal }
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

      if (message.type === "webview/intent/removePlot") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored removePlot because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }
        const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

        try {
          const transaction = deps.commitHostStateTransaction({
            datasetPath: resolvedDatasetPath,
            defaultXSignal: resolvedDataset.defaultXSignal,
            reason: "removePlot:tab-remove",
            mutate: (workspace) =>
              reduceWorkspaceState(workspace, {
                type: "plot/remove",
                payload: { plotId: message.payload.plotId }
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
        } catch (error) {
          deps.logDebug?.("Ignored invalid webview removePlot message payload.", {
            payload: message.payload,
            error: getErrorMessage(error)
          });
        }
        return;
      }

      if (message.type === "webview/intent/renamePlot") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored renamePlot because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }
        const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

        try {
          const transaction = deps.commitHostStateTransaction({
            datasetPath: resolvedDatasetPath,
            defaultXSignal: resolvedDataset.defaultXSignal,
            reason: "renamePlot:tab-rename",
            mutate: (workspace) =>
              reduceWorkspaceState(workspace, {
                type: "plot/rename",
                payload: {
                  plotId: message.payload.plotId,
                  name: message.payload.name
                }
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
        } catch (error) {
          deps.logDebug?.("Ignored invalid webview renamePlot message payload.", {
            payload: message.payload,
            error: getErrorMessage(error)
          });
        }
        return;
      }

      if (message.type === "webview/intent/setActiveAxis") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored setActiveAxis because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }
        const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

        const axisId = message.payload.axisId;
        if (!isAxisId(axisId)) {
          deps.logDebug?.("Ignored invalid webview setActiveAxis message payload.", {
            payload: message.payload,
            error: `Invalid axis id: ${axisId}`
          });
          return;
        }

        const transaction = deps.commitHostStateTransaction({
          datasetPath: resolvedDatasetPath,
          defaultXSignal: resolvedDataset.defaultXSignal,
          reason: "setActiveAxis:lane-click",
          mutate: (workspace) => workspace,
          selectActiveAxis: () => ({
            plotId: message.payload.plotId,
            axisId
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

      if (message.type === "webview/intent/setTraceAxis") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored setTraceAxis because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }
        const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

        const axisId = message.payload.axisId;
        if (!isAxisId(axisId)) {
          deps.logDebug?.("Ignored invalid webview setTraceAxis message payload.", {
            payload: message.payload,
            error: `Invalid axis id: ${axisId}`
          });
          return;
        }

        try {
          const transaction = deps.commitHostStateTransaction({
            datasetPath: resolvedDatasetPath,
            defaultXSignal: resolvedDataset.defaultXSignal,
            reason: "setTraceAxis:lane-drag",
            mutate: (workspace) => applySetTraceAxisAction(workspace, message.payload),
            selectActiveAxis: () => ({
              plotId: message.payload.plotId,
              axisId
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
        } catch (error) {
          deps.logDebug?.("Ignored invalid webview setTraceAxis message payload.", {
            payload: message.payload,
            error: getErrorMessage(error)
          });
        }
        return;
      }

      if (message.type === "webview/intent/addAxis") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored addAxis because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }
        const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

        const transaction = deps.commitHostStateTransaction({
          datasetPath: resolvedDatasetPath,
          defaultXSignal: resolvedDataset.defaultXSignal,
          reason: "addAxis:lane-click",
          mutate: (workspace) =>
            reduceWorkspaceState(workspace, {
              type: "axis/add",
              payload: {
                plotId: message.payload.plotId,
                afterAxisId: message.payload.afterAxisId
              }
            }),
          selectActiveAxis: ({ previous, nextWorkspace }) => {
            const newAxisId = findNewAxisId(previous.workspace, nextWorkspace, message.payload.plotId);
            if (!newAxisId) {
              return undefined;
            }
            return { plotId: message.payload.plotId, axisId: newAxisId };
          }
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

      if (message.type === "webview/intent/reorderAxis") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored reorderAxis because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }
        const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

        const axisId = message.payload.axisId;
        if (!isAxisId(axisId)) {
          deps.logDebug?.("Ignored invalid webview reorderAxis message payload.", {
            payload: message.payload,
            error: `Invalid axis id: ${axisId}`
          });
          return;
        }

        try {
          const transaction = deps.commitHostStateTransaction({
            datasetPath: resolvedDatasetPath,
            defaultXSignal: resolvedDataset.defaultXSignal,
            reason: "reorderAxis:lane-controls",
            mutate: (workspace) =>
              reduceWorkspaceState(
                reduceWorkspaceState(workspace, {
                  type: "plot/setActive",
                  payload: { plotId: message.payload.plotId }
                }),
                {
                  type: "axis/reorder",
                  payload: {
                    plotId: message.payload.plotId,
                    axisId,
                    toIndex: message.payload.toIndex
                  }
                }
              )
          });

          void panel.webview.postMessage(
            createProtocolEnvelope("host/statePatch", {
              revision: transaction.next.revision,
              workspace: transaction.next.workspace,
              viewerState: transaction.next.viewerState,
              reason: transaction.reason
            })
          );
        } catch (error) {
          deps.logDebug?.("Ignored invalid webview reorderAxis message payload.", {
            payload: message.payload,
            error: getErrorMessage(error)
          });
        }
        return;
      }

      if (message.type === "webview/intent/removeAxisAndTraces") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored removeAxisAndTraces because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }
        const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

        const axisId = message.payload.axisId;
        if (!isAxisId(axisId)) {
          deps.logDebug?.("Ignored invalid webview removeAxisAndTraces message payload.", {
            payload: message.payload,
            error: `Invalid axis id: ${axisId}`
          });
          return;
        }

        try {
          const transaction = deps.commitHostStateTransaction({
            datasetPath: resolvedDatasetPath,
            defaultXSignal: resolvedDataset.defaultXSignal,
            reason: "removeAxisAndTraces:lane-controls",
            mutate: (workspace) => {
              let nextWorkspace = reduceWorkspaceState(workspace, {
                type: "plot/setActive",
                payload: { plotId: message.payload.plotId }
              });
              const targetPlot = nextWorkspace.plots.find((plot) => plot.id === message.payload.plotId);
              const removableTraceIds = new Set(message.payload.traceIds);
              for (const trace of targetPlot?.traces ?? []) {
                if (!removableTraceIds.has(trace.id) || trace.axisId !== axisId) {
                  continue;
                }
                nextWorkspace = reduceWorkspaceState(nextWorkspace, {
                  type: "trace/remove",
                  payload: { plotId: message.payload.plotId, traceId: trace.id }
                });
              }
              return reduceWorkspaceState(nextWorkspace, {
                type: "axis/remove",
                payload: { plotId: message.payload.plotId, axisId }
              });
            },
            selectActiveAxis: ({ previous, nextWorkspace }) => {
              const previousPlot = previous.workspace.plots.find((plot) => plot.id === message.payload.plotId);
              const nextPlot = nextWorkspace.plots.find((plot) => plot.id === message.payload.plotId);
              if (!nextPlot) {
                return undefined;
              }
              if (!previousPlot) {
                return { plotId: nextPlot.id, axisId: nextPlot.axes[0]?.id ?? axisId };
              }
              const removedAxisIndex = previousPlot.axes.findIndex((axis) => axis.id === axisId);
              if (removedAxisIndex < 0) {
                return undefined;
              }
              const fallbackIndex = Math.max(0, Math.min(removedAxisIndex, nextPlot.axes.length - 1));
              const fallbackAxisId = nextPlot.axes[fallbackIndex]?.id;
              if (!fallbackAxisId) {
                return undefined;
              }
              return { plotId: nextPlot.id, axisId: fallbackAxisId };
            }
          });

          void panel.webview.postMessage(
            createProtocolEnvelope("host/statePatch", {
              revision: transaction.next.revision,
              workspace: transaction.next.workspace,
              viewerState: transaction.next.viewerState,
              reason: transaction.reason
            })
          );
        } catch (error) {
          deps.logDebug?.("Ignored invalid webview removeAxisAndTraces message payload.", {
            payload: message.payload,
            error: getErrorMessage(error)
          });
        }
        return;
      }

      if (message.type === "webview/intent/setTraceVisible") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored setTraceVisible because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }
        const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

        try {
          const transaction = deps.commitHostStateTransaction({
            datasetPath: resolvedDatasetPath,
            defaultXSignal: resolvedDataset.defaultXSignal,
            reason: "setTraceVisible:lane-chip",
            mutate: (workspace) =>
              reduceWorkspaceState(
                reduceWorkspaceState(workspace, {
                  type: "plot/setActive",
                  payload: { plotId: message.payload.plotId }
                }),
                {
                  type: "trace/setVisible",
                  payload: {
                    plotId: message.payload.plotId,
                    traceId: message.payload.traceId,
                    visible: message.payload.visible
                  }
                }
              )
          });

          void panel.webview.postMessage(
            createProtocolEnvelope("host/statePatch", {
              revision: transaction.next.revision,
              workspace: transaction.next.workspace,
              viewerState: transaction.next.viewerState,
              reason: transaction.reason
            })
          );
        } catch (error) {
          deps.logDebug?.("Ignored invalid webview setTraceVisible message payload.", {
            payload: message.payload,
            error: getErrorMessage(error)
          });
        }
        return;
      }

      if (message.type === "webview/intent/removeTrace") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored removeTrace because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }
        const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

        try {
          const transaction = deps.commitHostStateTransaction({
            datasetPath: resolvedDatasetPath,
            defaultXSignal: resolvedDataset.defaultXSignal,
            reason: "removeTrace:lane-chip",
            mutate: (workspace) =>
              reduceWorkspaceState(
                reduceWorkspaceState(workspace, {
                  type: "plot/setActive",
                  payload: { plotId: message.payload.plotId }
                }),
                {
                  type: "trace/remove",
                  payload: {
                    plotId: message.payload.plotId,
                    traceId: message.payload.traceId
                  }
                }
              )
          });

          void panel.webview.postMessage(
            createProtocolEnvelope("host/statePatch", {
              revision: transaction.next.revision,
              workspace: transaction.next.workspace,
              viewerState: transaction.next.viewerState,
              reason: transaction.reason
            })
          );
        } catch (error) {
          deps.logDebug?.("Ignored invalid webview removeTrace message payload.", {
            payload: message.payload,
            error: getErrorMessage(error)
          });
        }
        return;
      }

      if (message.type === "webview/intent/clearPlot") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored clearPlot because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }
        const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

        try {
          const confirmation = await deps.showWarning(
            "Clear the active plot? This removes all lanes and traces from the current plot."
          );
          if (confirmation !== "Clear Plot") {
            return;
          }

          const transaction = deps.commitHostStateTransaction({
            datasetPath: resolvedDatasetPath,
            defaultXSignal: resolvedDataset.defaultXSignal,
            reason: "clearPlot:plot-header",
            mutate: (workspace) =>
              reduceWorkspaceState(
                reduceWorkspaceState(workspace, {
                  type: "plot/setActive",
                  payload: { plotId: message.payload.plotId }
                }),
                {
                  type: "plot/clear",
                  payload: { plotId: message.payload.plotId }
                }
              )
          });

          void panel.webview.postMessage(
            createProtocolEnvelope("host/statePatch", {
              revision: transaction.next.revision,
              workspace: transaction.next.workspace,
              viewerState: transaction.next.viewerState,
              reason: transaction.reason
            })
          );
        } catch (error) {
          deps.logDebug?.("Ignored invalid webview clearPlot message payload.", {
            payload: message.payload,
            error: getErrorMessage(error)
          });
        }
        return;
      }

      if (message.type === "webview/intent/refreshSignals") {
        const context = resolveDatasetContext(message.payload.viewerId);
        if (!context) {
          deps.logDebug?.("Ignored refreshSignals because no dataset is bound to this panel.", {
            payload: message.payload
          });
          return;
        }

        try {
          await deps.refreshAllLoadedSignals?.();
        } catch (error) {
          deps.showError(`Failed to refresh loaded signals: ${getErrorMessage(error)}`);
          deps.logDebug?.("Failed refreshSignals request from webview intent.", {
            payload: message.payload,
            error: getErrorMessage(error)
          });
        }
        return;
      }

      if (message.type !== "webview/ready") {
        deps.logDebug?.("Ignored unsupported webview message type.", message.type);
        return;
      }

      void panel.webview.postMessage(createProtocolEnvelope("host/init", { title: "Wave Viewer" }));
      const viewerSessionContext = deps.resolveViewerSessionContext?.(viewerId);
      const boundDatasetPath = viewerSessionContext?.datasetPath ?? datasetPath;
      void panel.webview.postMessage(
        createProtocolEnvelope(
          "host/viewerBindingUpdated",
          createViewerBindingUpdatedPayload(viewerId, boundDatasetPath)
        )
      );

      const context = resolveDatasetContext(viewerId);
      if (!context) {
        return;
      }
      const { datasetPath: resolvedDatasetPath, normalizedDataset: resolvedDataset } = context;

      const cachedWorkspace = deps.getCachedWorkspace?.(resolvedDatasetPath);
      if (cachedWorkspace) {
        const hydratedReplay = hydrateWorkspaceReplayPayload(
          viewerId,
          resolvedDatasetPath,
          resolvedDataset,
          cachedWorkspace,
          deps.logDebug
        );
        if (hydratedReplay.workspace !== cachedWorkspace) {
          deps.setCachedWorkspace?.(resolvedDatasetPath, hydratedReplay.workspace);
        }
        for (const tracePayload of hydratedReplay.tracePayloads) {
          void panel.webview.postMessage(
            createProtocolEnvelope("host/tupleUpsert", {
              tuples: [tracePayload]
            })
          );
        }
        const snapshot = deps.getHostStateSnapshot?.(resolvedDatasetPath);
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
        const sidecarLayoutPath = `${documentPath}.wave-viewer.yaml`;

        let workspace = createWorkspaceState(loaded.defaultXSignal);
        let laneIdByAxisIdByPlotId: LayoutAxisLaneIdMap | undefined;
        let xDatasetPathByPlotId: LayoutPlotXDatasetPathMap | undefined;

        const hasExistingSidecar =
          deps.fileExists !== undefined && deps.readTextFile !== undefined
            ? deps.fileExists(sidecarLayoutPath)
            : false;

        if (hasExistingSidecar) {
          const yamlText = deps.readTextFile!(sidecarLayoutPath);
          const sidecarDatasets = readPlotSpecDatasetsV1(yamlText, sidecarLayoutPath);
          const loadedByPath = new Map<string, LoadedDatasetRecord>();
          const availableSignalsByDatasetId: Record<string, string[]> = {};
          for (const sidecarDataset of sidecarDatasets) {
            let loadedSidecarDataset = loadedByPath.get(sidecarDataset.path);
            if (!loadedSidecarDataset) {
              loadedSidecarDataset = deps.loadDataset(sidecarDataset.path);
              loadedByPath.set(sidecarDataset.path, loadedSidecarDataset);
              deps.registerLoadedDataset(sidecarDataset.path, loadedSidecarDataset);
            }
            availableSignalsByDatasetId[sidecarDataset.id] = collectAvailableSignalsForSpecImport(
              loadedSidecarDataset
            );
          }
          const importedRaw = importPlotSpecV1({
            yamlText,
            availableSignals: availableSignalsByDatasetId,
            specPath: sidecarLayoutPath
          });
          const imported = normalizeImportedWorkspaceSignals(importedRaw, loadedByPath);
          workspace = imported.workspace;
          laneIdByAxisIdByPlotId = imported.laneIdByAxisIdByPlotId;
          xDatasetPathByPlotId = imported.xDatasetPathByPlotId;
        } else if (deps.writeTextFile) {
          const yamlText = exportPlotSpecV1({
            datasetPath: documentPath,
            workspace,
            specPath: sidecarLayoutPath
          });
          deps.writeTextFile(sidecarLayoutPath, yamlText);
        }

        deps.setCachedWorkspace?.(documentPath, workspace);
        if (laneIdByAxisIdByPlotId) {
          deps.recordLayoutAxisLaneIdMap?.(sidecarLayoutPath, laneIdByAxisIdByPlotId);
        }
        if (xDatasetPathByPlotId) {
          deps.recordLayoutXDatasetPathMap?.(sidecarLayoutPath, xDatasetPathByPlotId);
        }

        if (deps.openViewerForDataset && deps.bindViewerToLayout) {
          const viewerId = await deps.openViewerForDataset(documentPath);
          if (viewerId) {
            deps.bindViewerToLayout(viewerId, sidecarLayoutPath, documentPath);
          }
        }
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
    const reloadedDatasetPaths: string[] = [];
    for (const documentPath of deps.getLoadedDatasetPaths()) {
      try {
        const loaded = deps.loadDataset(documentPath);
        deps.registerLoadedDataset(documentPath, loaded);
        reloadedDatasetPaths.push(documentPath);
      } catch (error) {
        deps.showError(`Failed to reload '${documentPath}': ${getErrorMessage(error)}`);
      }
    }
    await deps.onReloadCompleted?.(reloadedDatasetPaths);
  };
}

export function createRemoveLoadedFileCommand(
  deps: RemoveLoadedFileCommandDeps
): (item?: unknown) => void {
  return (item?: unknown) => {
    const datasetPath = resolveDatasetPathFromCommandArgument(item);
    if (!datasetPath) {
      deps.showError("Select a loaded dataset file in the Wave Viewer side panel.");
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
      deps.showError("Open a dataset file in the editor before exporting a Wave Viewer spec.");
      return;
    }

    if (!isCsvFile(activeDocument.fileName)) {
      deps.showError("Wave Viewer spec export requires an active .csv file.");
      return;
    }

    let normalizedDataset: LoadedDatasetRecord;
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
      workspace,
      specPath: savePath
    });

    deps.writeTextFile(savePath, yaml);
    deps.showInformation(`Wave Viewer spec exported to ${savePath}`);
  };
}

export function createImportSpecCommand(deps: ImportSpecCommandDeps): () => Promise<void> {
  return async () => {
    const activeDocument = deps.getActiveDocument();
    if (!activeDocument) {
      deps.showError("Open a dataset file in the editor before importing a Wave Viewer spec.");
      return;
    }

    if (!isCsvFile(activeDocument.fileName)) {
      deps.showError("Wave Viewer spec import requires an active .csv file.");
      return;
    }

    let normalizedDataset: LoadedDatasetRecord;
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
        availableSignals: collectAvailableSignalsForSpecImport(normalizedDataset),
        specPath
      });
    } catch (error) {
      deps.showError(getErrorMessage(error));
      return;
    }

    if (!isSameDatasetReference(parsed.datasetPath, activeDocument.uri.fsPath)) {
      deps.showError(
        `Wave Viewer reference-only spec points to '${parsed.datasetPath}', but the active dataset is '${activeDocument.uri.fsPath}'. Open the referenced dataset file or re-export the spec from the current file.`
      );
      return;
    }

    deps.setCachedWorkspace(activeDocument.uri.fsPath, parsed.workspace);
    deps.showInformation(`Wave Viewer spec imported from ${specPath}`);
  };
}

export function createOpenLayoutCommand(deps: OpenLayoutCommandDeps): () => Promise<void> {
  return async () => {
    const layoutPath = await deps.showOpenDialog();
    if (!layoutPath) {
      return;
    }

    let parsed: ReturnType<typeof importPlotSpecV1>;
    let activeViewerId = deps.getActiveViewerId();
    let loadedDataset: LoadedDatasetRecord;
    const loadedDatasetByPath = new Map<string, LoadedDatasetRecord>();
    try {
      const yamlText = deps.readTextFile(layoutPath);
      const datasetPath = readPlotSpecDatasetPathV1(yamlText, layoutPath);
      const referencedDatasets = readPlotSpecDatasetsV1(yamlText, layoutPath);
      const availableSignalsByDatasetId: Record<string, string[]> = {};
      for (const referencedDataset of referencedDatasets) {
        let loadedReferencedDataset = loadedDatasetByPath.get(referencedDataset.path);
        if (!loadedReferencedDataset) {
          loadedReferencedDataset = deps.loadDataset(referencedDataset.path);
          loadedDatasetByPath.set(referencedDataset.path, loadedReferencedDataset);
        }
        availableSignalsByDatasetId[referencedDataset.id] = collectAvailableSignalsForSpecImport(
          loadedReferencedDataset
        );
      }
      loadedDataset = loadedDatasetByPath.get(datasetPath) ?? deps.loadDataset(datasetPath);
      loadedDatasetByPath.set(datasetPath, loadedDataset);
      const parsedRaw = importPlotSpecV1({
        yamlText,
        availableSignals: availableSignalsByDatasetId,
        specPath: layoutPath
      });
      parsed = normalizeImportedWorkspaceSignals(parsedRaw, loadedDatasetByPath);

      const referencedDatasetPaths = collectReferencedDatasetPaths(
        parsed.datasetPath,
        parsed.workspace,
        parsed.xDatasetPathByPlotId
      );
      for (const referencedDatasetPath of referencedDatasetPaths) {
        const loadedReferencedDataset =
          loadedDatasetByPath.get(referencedDatasetPath) ?? deps.loadDataset(referencedDatasetPath);
        loadedDatasetByPath.set(referencedDatasetPath, loadedReferencedDataset);
        deps.registerLoadedDataset?.(referencedDatasetPath, loadedReferencedDataset);
      }
    } catch (error) {
      deps.showError(getErrorMessage(error));
      return;
    }

    if (!activeViewerId) {
      activeViewerId = await deps.ensureViewerForDataset?.(parsed.datasetPath);
    }
    if (!activeViewerId) {
      deps.showError("Focus a Wave Viewer panel before running Open Layout.");
      return;
    }

    const hydratedReplay = hydrateWorkspaceReplayPayload(
      activeViewerId,
      parsed.datasetPath,
      loadedDataset,
      parsed.workspace,
      deps.logDebug,
      (datasetPath) => loadedDatasetByPath.get(datasetPath)
    );
    const snapshot = deps.setCachedWorkspace(parsed.datasetPath, hydratedReplay.workspace);
    deps.recordLayoutAxisLaneIdMap?.(layoutPath, parsed.laneIdByAxisIdByPlotId);
    deps.recordLayoutXDatasetPathMap?.(layoutPath, parsed.xDatasetPathByPlotId);
    deps.bindViewerToLayout(activeViewerId, layoutPath, parsed.datasetPath);
    const panel = deps.getPanelForViewer(activeViewerId);
    if (panel) {
      void panel.webview.postMessage(
        createProtocolEnvelope(
          "host/viewerBindingUpdated",
          createViewerBindingUpdatedPayload(activeViewerId, parsed.datasetPath)
        )
      );
      if (hydratedReplay.tracePayloads.length > 0) {
        void panel.webview.postMessage(
          createProtocolEnvelope("host/tupleUpsert", {
            tuples: hydratedReplay.tracePayloads
          })
        );
      }
      void panel.webview.postMessage(
        createProtocolEnvelope("host/statePatch", {
          revision: snapshot.revision,
          workspace: snapshot.workspace,
          viewerState: snapshot.viewerState,
          reason: "openLayout:command"
        })
      );
    }
    deps.showInformation(`Wave Viewer layout opened from ${layoutPath}`);
  };
}

type SaveLayoutContextDeps = {
  getActiveViewerId(): string | undefined;
  resolveViewerSessionContext(viewerId: string): { datasetPath: string; layoutUri: string } | undefined;
  loadDataset(documentPath: string): LoadedDatasetRecord;
  getCachedWorkspace(documentPath: string): WorkspaceState | undefined;
  showError(message: string): void;
};

function resolveSaveLayoutContext(deps: SaveLayoutContextDeps): {
  viewerId: string;
  datasetPath: string;
  layoutUri: string;
  workspace: WorkspaceState;
  dataset: Dataset;
} | undefined {
  const viewerId = deps.getActiveViewerId();
  if (!viewerId) {
    deps.showError("Focus a Wave Viewer panel before running Save Layout.");
    return undefined;
  }

  const context = deps.resolveViewerSessionContext(viewerId);
  if (!context) {
    deps.showError("The focused viewer is not bound to a dataset/layout session.");
    return undefined;
  }

  let normalizedDataset: LoadedDatasetRecord;
  try {
    normalizedDataset = deps.loadDataset(context.datasetPath);
  } catch (error) {
    deps.showError(getErrorMessage(error));
    return undefined;
  }

  const workspace =
    deps.getCachedWorkspace(context.datasetPath) ??
    createWorkspaceState(normalizedDataset.defaultXSignal);
  const normalizedWorkspace = normalizeWorkspaceSignalsForActiveDataset(
    workspace,
    context.datasetPath,
    normalizedDataset
  );

  return {
    viewerId,
    datasetPath: context.datasetPath,
    layoutUri: context.layoutUri,
    workspace: normalizedWorkspace,
    dataset: normalizedDataset.dataset
  };
}

export function createSaveLayoutCommand(deps: SaveLayoutCommandDeps): () => Promise<void> {
  return async () => {
    const context = resolveSaveLayoutContext(deps);
    if (!context) {
      return;
    }

    const laneIdByAxisIdByPlotId = deps.resolveLayoutAxisLaneIdMap?.(context.layoutUri);
    const xDatasetPathByPlotId = deps.resolveLayoutXDatasetPathMap?.(context.layoutUri);
    const yaml = exportPlotSpecV1({
      datasetPath: context.datasetPath,
      workspace: context.workspace,
      specPath: context.layoutUri,
      laneIdByAxisIdByPlotId,
      xDatasetPathByPlotId
    });
    deps.writeTextFile(context.layoutUri, yaml);
    deps.showInformation(`Wave Viewer layout saved to ${context.layoutUri}`);
  };
}

export function createClearLayoutCommand(deps: ClearLayoutCommandDeps): () => Promise<void> {
  return async () => {
    const viewerId = deps.getActiveViewerId();
    if (!viewerId) {
      deps.showError("Focus a Wave Viewer panel before running Clear Layout.");
      return;
    }

    const context = deps.resolveViewerSessionContext(viewerId);
    if (!context) {
      deps.showError("The focused viewer is not bound to a dataset/layout session.");
      return;
    }

    const confirmation = await deps.showWarning(
      "Clear the current Wave Viewer layout? This removes all plot tabs and traces."
    );
    if (confirmation !== "Clear Layout") {
      return;
    }

    let normalizedDataset: LoadedDatasetRecord;
    try {
      normalizedDataset = deps.loadDataset(context.datasetPath);
    } catch (error) {
      deps.showError(getErrorMessage(error));
      return;
    }

    const transaction = deps.commitHostStateTransaction({
      datasetPath: context.datasetPath,
      defaultXSignal: normalizedDataset.defaultXSignal,
      reason: "clearLayout:command",
      mutate: (workspace) =>
        reduceWorkspaceState(workspace, {
          type: "workspace/clearLayout"
        })
    });

    const panel = deps.getPanelForViewer(viewerId);
    if (!panel) {
      return;
    }

    void panel.webview.postMessage(
      createProtocolEnvelope("host/statePatch", {
        revision: transaction.next.revision,
        workspace: transaction.next.workspace,
        viewerState: transaction.next.viewerState,
        reason: transaction.reason
      })
    );
  };
}

export function createSaveLayoutAsCommand(deps: SaveLayoutAsCommandDeps): () => Promise<void> {
  return async () => {
    const context = resolveSaveLayoutContext(deps);
    if (!context) {
      return;
    }

    const savePath = await deps.showSaveDialog(context.layoutUri);
    if (!savePath) {
      return;
    }

    const laneIdByAxisIdByPlotId = deps.resolveLayoutAxisLaneIdMap?.(context.layoutUri);
    const xDatasetPathByPlotId = deps.resolveLayoutXDatasetPathMap?.(context.layoutUri);
    const yaml = exportPlotSpecV1({
      datasetPath: context.datasetPath,
      workspace: context.workspace,
      specPath: savePath,
      laneIdByAxisIdByPlotId,
      xDatasetPathByPlotId
    });
    deps.writeTextFile(savePath, yaml);
    if (laneIdByAxisIdByPlotId) {
      deps.recordLayoutAxisLaneIdMap?.(savePath, cloneLaneIdMap(laneIdByAxisIdByPlotId));
    }
    if (xDatasetPathByPlotId) {
      deps.recordLayoutXDatasetPathMap?.(savePath, clonePlotXDatasetPathMap(xDatasetPathByPlotId));
    }
    deps.bindViewerToLayout(context.viewerId, savePath, context.datasetPath);
    deps.showInformation(`Wave Viewer layout saved to ${savePath}`);
  };
}

export function createExportFrozenBundleCommand(
  deps: ExportFrozenBundleCommandDeps
): () => Promise<void> {
  return async () => {
    const context = resolveSaveLayoutContext(deps);
    if (!context) {
      return;
    }

    const defaultLayoutPath = toFrozenLayoutPath(context.layoutUri);
    const selectedPath = await deps.showSaveDialog(defaultLayoutPath);
    if (!selectedPath) {
      return;
    }

    const frozenLayoutPath = toFrozenLayoutPath(selectedPath);
    if (path.resolve(frozenLayoutPath) === path.resolve(context.layoutUri)) {
      deps.showError("Frozen export failed: target layout path cannot overwrite the active interactive layout.");
      return;
    }
    const laneIdByAxisIdByPlotId = deps.resolveLayoutAxisLaneIdMap?.(context.layoutUri);
    const xDatasetPathByPlotId = deps.resolveLayoutXDatasetPathMap?.(context.layoutUri) ?? {};
    const referencedDatasets = collectExportPlotDatasets({
      datasetPath: context.datasetPath,
      workspace: context.workspace,
      xDatasetPathByPlotId
    });
    const frozenCsvPathByDatasetId = new Map<string, string>();
    const activeInteractiveDatasetPaths = new Set(referencedDatasets.map((dataset) => path.resolve(dataset.path)));
    for (const dataset of referencedDatasets) {
      const frozenCsvPath = toFrozenCsvPathForDatasetId(frozenLayoutPath, dataset.id);
      frozenCsvPathByDatasetId.set(dataset.id, frozenCsvPath);
      if (activeInteractiveDatasetPaths.has(path.resolve(frozenCsvPath))) {
        deps.showError("Frozen export failed: target CSV path cannot overwrite an active interactive CSV.");
        return;
      }
    }

    const requiredSignalsByDatasetPath = collectRequiredSignalsByDatasetPath(
      context.datasetPath,
      context.workspace,
      xDatasetPathByPlotId
    );
    const datasetExports: Array<{ datasetId: string; path: string; csvText: string }> = [];
    const missingSignalsByDataset: string[] = [];
    for (const referencedDataset of referencedDatasets) {
      let loadedDataset: LoadedDatasetRecord;
      try {
        loadedDataset = deps.loadDataset(referencedDataset.path);
      } catch (error) {
        deps.showError(
          `Frozen export failed: could not load dataset '${referencedDataset.path}': ${getErrorMessage(error)}`
        );
        return;
      }
      const availableSignals = new Set(loadedDataset.dataset.columns.map((column) => column.name));
      const requiredSignals = requiredSignalsByDatasetPath.get(referencedDataset.path) ?? [];
      const selectedSignalNames = requiredSignals.length > 0 ? requiredSignals : [loadedDataset.defaultXSignal];
      const missingSignals = selectedSignalNames.filter((signal) => !availableSignals.has(signal));
      if (missingSignals.length > 0) {
        missingSignalsByDataset.push(`${referencedDataset.id}: ${missingSignals.join(", ")}`);
        continue;
      }

      const selectedSignalSet = new Set(selectedSignalNames);
      const orderedSignalNames = loadedDataset.dataset.columns
        .map((column) => column.name)
        .filter((columnName) => selectedSignalSet.has(columnName));
      const frozenCsvPath = frozenCsvPathByDatasetId.get(referencedDataset.id);
      if (!frozenCsvPath) {
        throw new Error(`Missing frozen CSV path for dataset id ${referencedDataset.id}.`);
      }
      datasetExports.push({
        datasetId: referencedDataset.id,
        path: frozenCsvPath,
        csvText: serializeDatasetToCsv({
          dataset: loadedDataset.dataset,
          signalNames: orderedSignalNames
        })
      });
    }
    if (missingSignalsByDataset.length > 0) {
      deps.showError(
        `Frozen export failed: workspace references missing dataset signal(s): ${missingSignalsByDataset.join("; ")}.`
      );
      return;
    }

    const frozenDatasetPathByPath = new Map(
      referencedDatasets.map((dataset) => [dataset.path, frozenCsvPathByDatasetId.get(dataset.id) ?? ""])
    );
    const frozenXDatasetPathByPlotId = rewriteXDatasetPathMap(
      xDatasetPathByPlotId,
      frozenDatasetPathByPath
    );
    const frozenWorkspace = rewriteWorkspaceTraceSourceDatasets(
      context.workspace,
      context.datasetPath,
      frozenDatasetPathByPath
    );
    const frozenActiveDatasetPath = frozenDatasetPathByPath.get(context.datasetPath);
    if (!frozenActiveDatasetPath) {
      throw new Error("Missing frozen active dataset path for frozen layout export.");
    }
    const yamlText = exportPlotSpecV1({
      datasetPath: frozenActiveDatasetPath,
      workspace: frozenWorkspace,
      specPath: frozenLayoutPath,
      laneIdByAxisIdByPlotId,
      xDatasetPathByPlotId: frozenXDatasetPathByPlotId
    });

    for (const datasetExport of datasetExports) {
      deps.writeTextFile(datasetExport.path, datasetExport.csvText);
    }
    deps.writeTextFile(frozenLayoutPath, yamlText);
    const frozenCsvPaths = datasetExports.map((datasetExport) => datasetExport.path);
    deps.showInformation(
      `Wave Viewer frozen bundle exported to ${frozenLayoutPath} and dataset CSVs: ${frozenCsvPaths.join(", ")}`
    );
  };
}

function isSameDatasetReference(leftPath: string, rightPath: string): boolean {
  return path.resolve(leftPath) === path.resolve(rightPath);
}

function collectRequiredSignalsByDatasetPath(
  activeDatasetPath: string,
  workspace: WorkspaceState,
  xDatasetPathByPlotId: LayoutPlotXDatasetPathMap
): Map<string, string[]> {
  const requiredSignalsByDatasetPath = new Map<string, string[]>();
  const seenByDatasetPath = new Map<string, Set<string>>();
  const add = (datasetPath: string, signal: string): void => {
    if (!requiredSignalsByDatasetPath.has(datasetPath)) {
      requiredSignalsByDatasetPath.set(datasetPath, []);
      seenByDatasetPath.set(datasetPath, new Set<string>());
    }
    const seen = seenByDatasetPath.get(datasetPath);
    if (!seen || seen.has(signal)) {
      return;
    }
    seen.add(signal);
    requiredSignalsByDatasetPath.get(datasetPath)?.push(signal);
  };

  for (const plot of workspace.plots) {
    const xDatasetPath = getPlotXDatasetPath(plot.id, xDatasetPathByPlotId, activeDatasetPath);
    add(xDatasetPath, plot.xSignal);
    for (const trace of plot.traces) {
      const traceDatasetPath = getTraceDatasetPath(trace.sourceId, activeDatasetPath);
      add(traceDatasetPath, trace.signal);
    }
  }

  return requiredSignalsByDatasetPath;
}

function collectReferencedDatasetPaths(
  activeDatasetPath: string,
  workspace: WorkspaceState,
  xDatasetPathByPlotId: LayoutPlotXDatasetPathMap
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (datasetPath: string | undefined): void => {
    if (!datasetPath || seen.has(datasetPath)) {
      return;
    }
    seen.add(datasetPath);
    paths.push(datasetPath);
  };

  add(activeDatasetPath);
  for (const datasetPath of Object.values(xDatasetPathByPlotId)) {
    add(datasetPath);
  }
  for (const plot of workspace.plots) {
    for (const trace of plot.traces) {
      const sourceId = trace.sourceId ?? "";
      const separatorIndex = sourceId.lastIndexOf("::");
      if (separatorIndex <= 0) {
        continue;
      }
      add(sourceId.slice(0, separatorIndex));
    }
  }

  return paths;
}

function collectAvailableSignalsForSpecImport(loaded: LoadedDatasetRecord): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (signal: string): void => {
    const next = signal.trim();
    if (next.length === 0 || seen.has(next)) {
      return;
    }
    seen.add(next);
    ordered.push(next);
  };

  for (const column of loaded.dataset.columns) {
    add(column.name);
  }
  for (const signal of loaded.explorerSignals ?? []) {
    add(signal);
  }
  for (const alias of Object.keys(loaded.signalAliasLookup ?? {})) {
    add(alias);
  }
  for (const complexSignalPath of loaded.complexSignalPaths ?? []) {
    for (const accessor of loaded.complexSignalAccessors ?? COMPLEX_SIGNAL_ACCESSORS) {
      add(`${complexSignalPath}.${accessor}`);
    }
  }
  for (const [alias, mapped] of Object.entries(loaded.signalAliasLookup ?? {})) {
    const mappedTrimmed = mapped.trim();
    if (mappedTrimmed.length === 0) {
      continue;
    }
    const isComplexSignal = (loaded.complexSignalPaths ?? []).includes(mappedTrimmed);
    if (!isComplexSignal) {
      continue;
    }
    for (const accessor of loaded.complexSignalAccessors ?? COMPLEX_SIGNAL_ACCESSORS) {
      add(`${alias}.${accessor}`);
    }
  }

  return ordered;
}

function normalizeSignalForDataset(signal: string, loadedDataset: LoadedDatasetRecord | undefined): string {
  const trimmed = signal.trim();
  if (trimmed.length === 0) {
    return signal;
  }

  const mapped = loadedDataset?.signalAliasLookup?.[trimmed];
  if (typeof mapped === "string" && mapped.trim().length > 0) {
    return mapped.trim();
  }

  const { base, accessor } = parseComplexSignalReference(trimmed);
  if (!accessor) {
    return trimmed;
  }

  const mappedBase = loadedDataset?.signalAliasLookup?.[base];
  if (typeof mappedBase !== "string" || mappedBase.trim().length === 0) {
    return trimmed;
  }

  return `${mappedBase.trim()}.${accessor}`;
}

function rewriteSourceIdSignal(sourceId: string | undefined, signal: string): string | undefined {
  if (!sourceId) {
    return sourceId;
  }
  const separatorIndex = sourceId.lastIndexOf("::");
  if (separatorIndex <= 0) {
    return sourceId;
  }
  return `${sourceId.slice(0, separatorIndex)}::${signal}`;
}

function normalizeWorkspaceSignalsForActiveDataset(
  workspace: WorkspaceState,
  activeDatasetPath: string,
  loadedDataset: LoadedDatasetRecord
): WorkspaceState {
  let changed = false;
  const nextPlots = workspace.plots.map((plot) => {
    const normalizedXSignal = normalizeSignalForDataset(plot.xSignal, loadedDataset);
    if (normalizedXSignal !== plot.xSignal) {
      changed = true;
    }
    const nextTraces = plot.traces.map((trace) => {
      const traceDatasetPath = getTraceDatasetPath(trace.sourceId, activeDatasetPath);
      if (traceDatasetPath !== activeDatasetPath) {
        return trace;
      }
      const normalizedSignal = normalizeSignalForDataset(trace.signal, loadedDataset);
      const normalizedSourceId = rewriteSourceIdSignal(trace.sourceId, normalizedSignal);
      if (normalizedSignal === trace.signal && normalizedSourceId === trace.sourceId) {
        return trace;
      }
      changed = true;
      return {
        ...trace,
        signal: normalizedSignal,
        sourceId: normalizedSourceId
      };
    });
    if (!changed && normalizedXSignal === plot.xSignal && nextTraces.every((trace, idx) => trace === plot.traces[idx])) {
      return plot;
    }
    return {
      ...plot,
      xSignal: normalizedXSignal,
      traces: nextTraces
    };
  });

  return changed
    ? {
        ...workspace,
        plots: nextPlots
      }
    : workspace;
}

function normalizeImportedWorkspaceSignals(
  parsed: ReturnType<typeof importPlotSpecV1>,
  loadedDatasetByPath: ReadonlyMap<string, LoadedDatasetRecord>
): ReturnType<typeof importPlotSpecV1> {
  let changed = false;
  const nextPlots = parsed.workspace.plots.map((plot) => {
    const xDatasetPath = getPlotXDatasetPath(plot.id, parsed.xDatasetPathByPlotId, parsed.datasetPath);
    const normalizedXSignal = normalizeSignalForDataset(
      plot.xSignal,
      loadedDatasetByPath.get(xDatasetPath)
    );
    if (normalizedXSignal !== plot.xSignal) {
      changed = true;
    }
    const nextTraces = plot.traces.map((trace) => {
      const traceDatasetPath = getTraceDatasetPath(trace.sourceId, parsed.datasetPath);
      const normalizedSignal = normalizeSignalForDataset(
        trace.signal,
        loadedDatasetByPath.get(traceDatasetPath)
      );
      const normalizedSourceId = rewriteSourceIdSignal(trace.sourceId, normalizedSignal);
      if (normalizedSignal === trace.signal && normalizedSourceId === trace.sourceId) {
        return trace;
      }
      changed = true;
      return {
        ...trace,
        signal: normalizedSignal,
        sourceId: normalizedSourceId
      };
    });
    if (!changed && normalizedXSignal === plot.xSignal && nextTraces.every((trace, idx) => trace === plot.traces[idx])) {
      return plot;
    }
    return {
      ...plot,
      xSignal: normalizedXSignal,
      traces: nextTraces
    };
  });

  if (!changed) {
    return parsed;
  }
  return {
    ...parsed,
    workspace: {
      ...parsed.workspace,
      plots: nextPlots
    }
  };
}

function toFrozenLayoutPath(filePath: string): string {
  if (/\.frozen\.wave-viewer\.ya?ml$/i.test(filePath)) {
    return filePath;
  }
  return `${filePath.replace(/(\.wave-viewer)?\.(ya?ml)$/i, "").replace(/\.csv$/i, "")}.frozen.wave-viewer.yaml`;
}

function toFrozenCsvPathForDatasetId(frozenLayoutPath: string, datasetId: string): string {
  if (!/\.frozen\.wave-viewer\.ya?ml$/i.test(frozenLayoutPath)) {
    return `${frozenLayoutPath}.${datasetId}.frozen.csv`;
  }
  return `${frozenLayoutPath.replace(/\.frozen\.wave-viewer\.ya?ml$/i, "")}.${datasetId}.frozen.csv`;
}

function rewriteXDatasetPathMap(
  xDatasetPathByPlotId: LayoutPlotXDatasetPathMap,
  frozenDatasetPathByPath: Map<string, string>
): LayoutPlotXDatasetPathMap {
  const rewritten: LayoutPlotXDatasetPathMap = {};
  for (const [plotId, datasetPath] of Object.entries(xDatasetPathByPlotId)) {
    rewritten[plotId] = frozenDatasetPathByPath.get(datasetPath) ?? datasetPath;
  }
  return rewritten;
}

function rewriteWorkspaceTraceSourceDatasets(
  workspace: WorkspaceState,
  activeDatasetPath: string,
  frozenDatasetPathByPath: Map<string, string>
): WorkspaceState {
  return {
    ...workspace,
    plots: workspace.plots.map((plot) => ({
      ...plot,
      traces: plot.traces.map((trace) => ({
        ...trace,
        sourceId: rewriteTraceSourceId(trace.sourceId, activeDatasetPath, frozenDatasetPathByPath)
      }))
    }))
  };
}

function rewriteTraceSourceId(
  sourceId: string | undefined,
  activeDatasetPath: string,
  frozenDatasetPathByPath: Map<string, string>
): string | undefined {
  if (!sourceId) {
    return sourceId;
  }
  const separatorIndex = sourceId.lastIndexOf("::");
  if (separatorIndex <= 0) {
    return sourceId;
  }
  const datasetPath = sourceId.slice(0, separatorIndex).trim();
  const signal = sourceId.slice(separatorIndex + 2);
  const normalizedDatasetPath = datasetPath.length > 0 ? datasetPath : activeDatasetPath;
  const frozenDatasetPath = frozenDatasetPathByPath.get(normalizedDatasetPath);
  if (!frozenDatasetPath) {
    return sourceId;
  }
  return `${frozenDatasetPath}::${signal}`;
}

function getPlotXDatasetPath(
  plotId: string,
  xDatasetPathByPlotId: LayoutPlotXDatasetPathMap | undefined,
  fallbackPath: string
): string {
  const candidate = xDatasetPathByPlotId?.[plotId]?.trim();
  return candidate && candidate.length > 0 ? candidate : fallbackPath;
}

function getTraceDatasetPath(sourceId: string | undefined, fallbackPath: string): string {
  if (!sourceId) {
    return fallbackPath;
  }
  const separatorIndex = sourceId.lastIndexOf("::");
  if (separatorIndex <= 0) {
    return fallbackPath;
  }
  const candidate = sourceId.slice(0, separatorIndex).trim();
  return candidate.length > 0 ? candidate : fallbackPath;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Failed to load dataset.";
}

function cloneLaneIdMap(source: LayoutAxisLaneIdMap): LayoutAxisLaneIdMap {
  const clone: LayoutAxisLaneIdMap = {};
  for (const [plotId, mapByAxis] of Object.entries(source)) {
    clone[plotId] = { ...mapByAxis };
  }
  return clone;
}

function clonePlotXDatasetPathMap(source: LayoutPlotXDatasetPathMap): LayoutPlotXDatasetPathMap {
  return { ...source };
}
