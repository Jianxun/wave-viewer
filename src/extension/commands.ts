import * as path from "node:path";

import { serializeDatasetToCsv } from "../core/csv/parseCsv";
import { exportPlotSpecV1 } from "../core/spec/exportSpec";
import { importPlotSpecV1, readPlotSpecDatasetPathV1 } from "../core/spec/importSpec";
import { createProtocolEnvelope, parseWebviewToHostMessage, type Dataset } from "../core/dataset/types";
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
  ExportFrozenBundleCommandDeps
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

    const normalizedByDatasetPath = new Map<string, { dataset: Dataset; defaultXSignal: string }>();
    if (datasetPath && normalizedDataset) {
      normalizedByDatasetPath.set(datasetPath, normalizedDataset);
    }

    const resolveDatasetContext = (
      requestedViewerId: string
    ): { datasetPath: string; normalizedDataset: { dataset: Dataset; defaultXSignal: string } } | undefined => {
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

    panel.webview.onDidReceiveMessage((rawMessage) => {
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
        availableSignals: normalizedDataset.dataset.columns.map((column) => column.name),
        specPath
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

export function createOpenLayoutCommand(deps: OpenLayoutCommandDeps): () => Promise<void> {
  return async () => {
    const activeViewerId = deps.getActiveViewerId();
    if (!activeViewerId) {
      deps.showError("Focus a Wave Viewer panel before running Open Layout.");
      return;
    }

    const layoutPath = await deps.showOpenDialog();
    if (!layoutPath) {
      return;
    }

    let parsed: ReturnType<typeof importPlotSpecV1>;
    let loadedDataset: { dataset: Dataset; defaultXSignal: string };
    try {
      const yamlText = deps.readTextFile(layoutPath);
      const datasetPath = readPlotSpecDatasetPathV1(yamlText, layoutPath);
      loadedDataset = deps.loadDataset(datasetPath);
      parsed = importPlotSpecV1({
        yamlText,
        availableSignals: loadedDataset.dataset.columns.map((column) => column.name),
        specPath: layoutPath
      });
    } catch (error) {
      deps.showError(getErrorMessage(error));
      return;
    }

    const hydratedReplay = hydrateWorkspaceReplayPayload(
      activeViewerId,
      parsed.datasetPath,
      loadedDataset,
      parsed.workspace,
      deps.logDebug
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
  loadDataset(documentPath: string): { dataset: Dataset; defaultXSignal: string };
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

  let normalizedDataset: { dataset: Dataset; defaultXSignal: string };
  try {
    normalizedDataset = deps.loadDataset(context.datasetPath);
  } catch (error) {
    deps.showError(getErrorMessage(error));
    return undefined;
  }

  const workspace =
    deps.getCachedWorkspace(context.datasetPath) ??
    createWorkspaceState(normalizedDataset.defaultXSignal);

  return {
    viewerId,
    datasetPath: context.datasetPath,
    layoutUri: context.layoutUri,
    workspace,
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

    let normalizedDataset: { dataset: Dataset; defaultXSignal: string };
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
    const frozenCsvPath = toFrozenCsvPath(frozenLayoutPath);
    if (path.resolve(frozenLayoutPath) === path.resolve(context.layoutUri)) {
      deps.showError("Frozen export failed: target layout path cannot overwrite the active interactive layout.");
      return;
    }
    if (path.resolve(frozenCsvPath) === path.resolve(context.datasetPath)) {
      deps.showError("Frozen export failed: target CSV path cannot overwrite the active interactive CSV.");
      return;
    }

    const requiredSignals = collectRequiredSignals(context.workspace);
    const availableSignals = new Set(context.dataset.columns.map((column) => column.name));
    const missingSignals = requiredSignals.filter((signal) => !availableSignals.has(signal));
    if (missingSignals.length > 0) {
      deps.showError(
        `Frozen export failed: workspace references missing dataset signal(s): ${missingSignals.join(", ")}.`
      );
      return;
    }

    const requiredSignalSet = new Set(requiredSignals);
    const orderedSignalNames = context.dataset.columns
      .map((column) => column.name)
      .filter((signalName) => requiredSignalSet.has(signalName));
    const csvText = serializeDatasetToCsv({
      dataset: context.dataset,
      signalNames: orderedSignalNames
    });
    const laneIdByAxisIdByPlotId = deps.resolveLayoutAxisLaneIdMap?.(context.layoutUri);
    const xDatasetPathByPlotId = deps.resolveLayoutXDatasetPathMap?.(context.layoutUri);
    const yamlText = exportPlotSpecV1({
      datasetPath: frozenCsvPath,
      workspace: context.workspace,
      specPath: frozenLayoutPath,
      laneIdByAxisIdByPlotId,
      xDatasetPathByPlotId
    });

    deps.writeTextFile(frozenCsvPath, csvText);
    deps.writeTextFile(frozenLayoutPath, yamlText);
    deps.showInformation(
      `Wave Viewer frozen bundle exported to ${frozenLayoutPath} and ${frozenCsvPath}`
    );
  };
}

function isSameDatasetReference(leftPath: string, rightPath: string): boolean {
  return path.resolve(leftPath) === path.resolve(rightPath);
}

function collectRequiredSignals(workspace: WorkspaceState): string[] {
  const requiredSignals: string[] = [];
  const seen = new Set<string>();
  const add = (signal: string): void => {
    if (!seen.has(signal)) {
      seen.add(signal);
      requiredSignals.push(signal);
    }
  };

  for (const plot of workspace.plots) {
    add(plot.xSignal);
    for (const trace of plot.traces) {
      add(trace.signal);
    }
  }

  return requiredSignals;
}

function toFrozenLayoutPath(filePath: string): string {
  if (/\.frozen\.wave-viewer\.ya?ml$/i.test(filePath)) {
    return filePath;
  }
  return `${filePath.replace(/(\.wave-viewer)?\.(ya?ml)$/i, "").replace(/\.csv$/i, "")}.frozen.wave-viewer.yaml`;
}

function toFrozenCsvPath(frozenLayoutPath: string): string {
  if (!/\.frozen\.wave-viewer\.ya?ml$/i.test(frozenLayoutPath)) {
    return `${frozenLayoutPath}.frozen.csv`;
  }
  return `${frozenLayoutPath.replace(/\.frozen\.wave-viewer\.ya?ml$/i, "")}.frozen.csv`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Failed to load CSV dataset.";
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
