import * as path from "node:path";

import { createProtocolEnvelope } from "../core/dataset/types";
import type { WorkspaceState } from "../webview/state/workspaceState";
import { applySidePanelSignalAction } from "./workspaceActions";
import type {
  HostToWebviewMessage,
  LoadedDatasetRecord,
  ResolveSidePanelSelectionDeps,
  RunResolvedSidePanelQuickAddDeps,
  RunResolvedSidePanelSignalActionDeps,
  SidePanelSignalAction
} from "./types";

export function resolveSidePanelSelection(
  deps: ResolveSidePanelSelectionDeps
): { documentPath: string; loadedDataset: LoadedDatasetRecord; signal: string } | undefined {
  const resolved = deps.selection;
  if (!resolved) {
    deps.showError("Select a numeric signal in the Wave Viewer side panel.");
    return undefined;
  }

  const documentPath = resolved.datasetPath ?? deps.getSingleLoadedDatasetPath();
  if (!documentPath) {
    deps.showError("Select a signal under a loaded CSV file in the Wave Viewer side panel.");
    return undefined;
  }

  const loadedDataset = deps.getLoadedDataset(documentPath);
  if (!loadedDataset) {
    if (deps.wasDatasetRemoved(documentPath)) {
      deps.showWarning(
        `CSV file '${path.basename(
          documentPath
        )}' was removed from loaded files. Load it again before using side-panel signal actions.`
      );
      return undefined;
    }

    deps.showError(`Loaded dataset '${documentPath}' is no longer available.`);
    return undefined;
  }

  const signals = loadedDataset.dataset.columns.map((column) => column.name);
  if (!signals.includes(resolved.signal)) {
    deps.showError(
      `Signal '${resolved.signal}' is not available in loaded dataset '${path.basename(documentPath)}'.`
    );
    return undefined;
  }

  return { documentPath, loadedDataset, signal: resolved.signal };
}

export function createDatasetLoadedPayload(
  documentPath: string,
  loaded: LoadedDatasetRecord
): Extract<HostToWebviewMessage, { type: "host/datasetLoaded" }>["payload"] {
  return {
    path: documentPath,
    fileName: path.basename(documentPath),
    rowCount: loaded.dataset.rowCount,
    columns: loaded.dataset.columns.map((column) => ({
      name: column.name,
      values: column.values
    })),
    defaultXSignal: loaded.defaultXSignal
  };
}

export function createViewerBindingUpdatedPayload(
  viewerId: string,
  datasetPath?: string
): Extract<HostToWebviewMessage, { type: "host/viewerBindingUpdated" }>["payload"] {
  return {
    viewerId,
    datasetPath
  };
}

export function toTraceSourceId(documentPath: string, signal: string): string {
  return `${documentPath}::${signal}`;
}

export function getAddedTraces(previous: WorkspaceState, next: WorkspaceState): Array<{
  id: string;
  signal: string;
  sourceId?: string;
}> {
  const previousTraceIds = new Set<string>();
  for (const plot of previous.plots) {
    for (const trace of plot.traces) {
      previousTraceIds.add(trace.id);
    }
  }

  const addedTraces: Array<{ id: string; signal: string; sourceId?: string }> = [];
  for (const plot of next.plots) {
    for (const trace of plot.traces) {
      if (previousTraceIds.has(trace.id)) {
        continue;
      }
      addedTraces.push({
        id: trace.id,
        signal: trace.signal,
        sourceId: trace.sourceId
      });
    }
  }

  return addedTraces;
}

export function hydrateWorkspaceReplayPayload(
  viewerId: string,
  documentPath: string,
  loadedDataset: LoadedDatasetRecord,
  workspace: WorkspaceState,
  logDebug?: (message: string, details?: unknown) => void
): {
  workspace: WorkspaceState;
  tracePayloads: Extract<HostToWebviewMessage, { type: "host/tupleUpsert" }>["payload"]["tuples"];
} {
  const tracePayloads: Extract<HostToWebviewMessage, { type: "host/tupleUpsert" }>["payload"]["tuples"] = [];
  const tracePayloadBySourceId = new Map<string, Extract<HostToWebviewMessage, { type: "host/tupleUpsert" }>["payload"]["tuples"][number]>();
  let hasHydratedTrace = false;

  const nextPlots = workspace.plots.map((plot) => {
    const nextTraces = plot.traces.map((trace) => {
      const sourceId = trace.sourceId ?? toTraceSourceId(documentPath, trace.signal);
      if (trace.sourceId !== sourceId) {
        hasHydratedTrace = true;
      }

      if (!tracePayloadBySourceId.has(sourceId)) {
        try {
          const payload = createSidePanelTraceInjectedPayload(
            viewerId,
            documentPath,
            loadedDataset,
            trace.signal,
            {
              traceId: trace.id,
              sourceId
            }
          ).trace;
          tracePayloadBySourceId.set(sourceId, payload);
          tracePayloads.push(payload);
        } catch (error) {
          logDebug?.("Skipped tuple hydration for cached workspace trace.", {
            traceId: trace.id,
            signal: trace.signal,
            sourceId,
            error: getErrorMessage(error)
          });
        }
      }

      if (!hasHydratedTrace) {
        return trace;
      }

      return {
        ...trace,
        sourceId
      };
    });

    if (!hasHydratedTrace) {
      return plot;
    }

    return {
      ...plot,
      traces: nextTraces
    };
  });

  return {
    workspace: hasHydratedTrace
      ? {
          ...workspace,
          plots: nextPlots
        }
      : workspace,
    tracePayloads
  };
}

export function createSidePanelTraceInjectedPayload(
  viewerId: string,
  documentPath: string,
  loadedDataset: LoadedDatasetRecord,
  signal: string,
  options?: { traceId?: string; sourceId?: string }
): { viewerId: string; trace: Extract<HostToWebviewMessage, { type: "host/tupleUpsert" }>["payload"]["tuples"][number] } {
  const xColumn = loadedDataset.dataset.columns.find(
    (column) => column.name === loadedDataset.defaultXSignal
  );
  const yColumn = loadedDataset.dataset.columns.find((column) => column.name === signal);
  if (!xColumn || !yColumn) {
    throw new Error(
      `Cannot build side-panel trace tuple for signal '${signal}' in '${path.basename(documentPath)}'.`
    );
  }

  return {
    viewerId,
    trace: {
      traceId: options?.traceId ?? `${viewerId}:${signal}:${yColumn.values.length}`,
      sourceId: options?.sourceId ?? toTraceSourceId(documentPath, signal),
      datasetPath: documentPath,
      xName: xColumn.name,
      yName: yColumn.name,
      x: xColumn.values,
      y: yColumn.values
    }
  };
}

function toSidePanelActionLabel(actionType: SidePanelSignalAction["type"]): string {
  if (actionType === "add-to-plot") {
    return "Add Signal to Plot";
  }
  if (actionType === "add-to-new-axis") {
    return "Add Signal to New Axis";
  }
  return "Reveal Signal in Plot";
}

export function createNoTargetViewerWarning(
  actionType: SidePanelSignalAction["type"],
  documentPath: string
): string {
  return `${toSidePanelActionLabel(
    actionType
  )} failed: no open Wave Viewer can accept '${path.basename(
    documentPath
  )}'. Open Wave Viewer for that CSV and retry.`;
}

export function runResolvedSidePanelSignalAction(
  deps: RunResolvedSidePanelSignalActionDeps
): WorkspaceState {
  const transaction = deps.commitHostStateTransaction({
    datasetPath: deps.documentPath,
    defaultXSignal: deps.loadedDataset.defaultXSignal,
    reason: `sidePanel:${deps.actionType}`,
    mutate: (workspace, viewerState) =>
      applySidePanelSignalAction(
        workspace,
        {
          type: deps.actionType,
          signal: deps.signal
        },
        {
          sourceId: toTraceSourceId(deps.documentPath, deps.signal),
          axisId: viewerState.activeAxisByPlotId[workspace.activePlotId]
        }
      ),
    selectActiveAxis:
      deps.actionType === "add-to-new-axis"
        ? ({ previous, nextWorkspace }) => {
            const previousAxisIds = new Set(
              previous.workspace.plots
                .find((plot) => plot.id === nextWorkspace.activePlotId)
                ?.axes.map((axis) => axis.id) ?? []
            );
            const newAxis = nextWorkspace.plots
              .find((plot) => plot.id === nextWorkspace.activePlotId)
              ?.axes.find((axis) => !previousAxisIds.has(axis.id));
            if (!newAxis) {
              return undefined;
            }
            return { plotId: nextWorkspace.activePlotId, axisId: newAxis.id };
          }
        : undefined
  });
  const workspace = transaction.previous.workspace;
  const nextWorkspace = transaction.next.workspace;

  const boundPanel = deps.getBoundPanel(deps.documentPath);
  const standalonePanel = deps.getStandalonePanel();
  const panel = boundPanel ?? standalonePanel;

  if (!panel) {
    deps.showWarning(createNoTargetViewerWarning(deps.actionType, deps.documentPath));
    return nextWorkspace;
  }

  const viewerId = deps.bindPanelToDataset(deps.documentPath, panel) ?? "viewer-unknown";

  if (!boundPanel && standalonePanel === panel) {
    deps.clearStandalonePanel(panel);
  }

  void panel.webview.postMessage(
    createProtocolEnvelope(
      "host/viewerBindingUpdated",
      createViewerBindingUpdatedPayload(viewerId)
    )
  );

  const tuples = getAddedTraces(workspace, nextWorkspace).map((trace) =>
    createSidePanelTraceInjectedPayload(
      viewerId,
      deps.documentPath,
      deps.loadedDataset,
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
      revision: transaction.next.revision,
      workspace: nextWorkspace,
      viewerState: transaction.next.viewerState,
      reason: transaction.reason
    })
  );

  return nextWorkspace;
}

export function runResolvedSidePanelQuickAdd(deps: RunResolvedSidePanelQuickAddDeps): boolean {
  if (deps.targetViewer.bindDataset) {
    deps.bindViewerToDataset(deps.targetViewer.viewerId, deps.documentPath);
  }

  void deps.targetViewer.panel.webview.postMessage(
    createProtocolEnvelope(
      "host/viewerBindingUpdated",
      createViewerBindingUpdatedPayload(deps.targetViewer.viewerId)
    )
  );

  let traceInjectionPayload:
    | Extract<HostToWebviewMessage, { type: "host/tupleUpsert" }>["payload"]["tuples"][number]
    | undefined;
  try {
    traceInjectionPayload = createSidePanelTraceInjectedPayload(
      deps.targetViewer.viewerId,
      deps.documentPath,
      deps.loadedDataset,
      deps.signal
    ).trace;
  } catch (error) {
    deps.showError(getErrorMessage(error));
    return false;
  }

  void deps.targetViewer.panel.webview.postMessage(
    createProtocolEnvelope("host/tupleUpsert", {
      tuples: [traceInjectionPayload]
    })
  );

  void deps.targetViewer.panel.webview.postMessage(
    createProtocolEnvelope("host/sidePanelQuickAdd", {
      signal: deps.signal,
      plotId: deps.quickAddTarget?.plotId,
      axisId: deps.quickAddTarget?.axisId
    })
  );
  return true;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Failed to load CSV dataset.";
}
