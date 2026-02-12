import { createWorkspaceState, type WorkspaceState } from "../webview/state/workspaceState";

export type ViewerInteractionState = {
  activePlotId: string;
  activeAxisByPlotId: Record<string, `y${number}`>;
};

export type HostStateSnapshot = {
  workspace: WorkspaceState;
  viewerState: ViewerInteractionState;
  revision: number;
};

export type HostStateTransaction = {
  datasetPath: string;
  defaultXSignal: string;
  reason: string;
  mutate(workspace: WorkspaceState, viewerState: ViewerInteractionState): WorkspaceState;
  selectActiveAxis?(params: {
    previous: HostStateSnapshot;
    nextWorkspace: WorkspaceState;
    nextViewerState: ViewerInteractionState;
  }): { plotId: string; axisId: `y${number}` } | undefined;
};

export type HostStateTransactionResult = {
  reason: string;
  previous: HostStateSnapshot;
  next: HostStateSnapshot;
};

export type HostStateStore = {
  getSnapshot(datasetPath: string): HostStateSnapshot | undefined;
  getWorkspace(datasetPath: string): WorkspaceState | undefined;
  ensureSnapshot(datasetPath: string, defaultXSignal: string): HostStateSnapshot;
  setWorkspace(datasetPath: string, workspace: WorkspaceState): HostStateSnapshot;
  commitTransaction(transaction: HostStateTransaction): HostStateTransactionResult;
};

type StoreRecord = {
  workspace: WorkspaceState;
  viewerState: ViewerInteractionState;
  revision: number;
};

export function createHostStateStore(): HostStateStore {
  const byDatasetPath = new Map<string, StoreRecord>();

  const getSnapshot = (datasetPath: string): HostStateSnapshot | undefined => {
    const record = byDatasetPath.get(datasetPath);
    if (!record) {
      return undefined;
    }
    return {
      workspace: record.workspace,
      viewerState: record.viewerState,
      revision: record.revision
    };
  };

  const ensureSnapshot = (datasetPath: string, defaultXSignal: string): HostStateSnapshot => {
    const existing = getSnapshot(datasetPath);
    if (existing) {
      return existing;
    }
    const workspace = createWorkspaceState(defaultXSignal);
    const viewerState = deriveViewerInteractionState(workspace);
    const next = {
      workspace,
      viewerState,
      revision: 0
    };
    byDatasetPath.set(datasetPath, next);
    return next;
  };

  const setWorkspace = (datasetPath: string, workspace: WorkspaceState): HostStateSnapshot => {
    const previous = byDatasetPath.get(datasetPath);
    const viewerState = deriveViewerInteractionState(workspace, previous?.viewerState);
    const next = {
      workspace,
      viewerState,
      revision: previous ? previous.revision + 1 : 0
    };
    byDatasetPath.set(datasetPath, next);
    return {
      workspace: next.workspace,
      viewerState: next.viewerState,
      revision: next.revision
    };
  };

  return {
    getSnapshot,
    getWorkspace: (datasetPath: string) => getSnapshot(datasetPath)?.workspace,
    ensureSnapshot,
    setWorkspace,
    commitTransaction: (transaction: HostStateTransaction): HostStateTransactionResult => {
      const previous = ensureSnapshot(transaction.datasetPath, transaction.defaultXSignal);
      const nextWorkspace = transaction.mutate(previous.workspace, previous.viewerState);
      let nextViewerState = deriveViewerInteractionState(
        nextWorkspace,
        previous.viewerState,
        previous.workspace
      );
      const selectedAxis = transaction.selectActiveAxis?.({
        previous,
        nextWorkspace,
        nextViewerState
      });
      if (selectedAxis) {
        const plot = nextWorkspace.plots.find((entry) => entry.id === selectedAxis.plotId);
        const axisExists = plot?.axes.some((axis) => axis.id === selectedAxis.axisId) ?? false;
        if (axisExists) {
          nextViewerState = {
            ...nextViewerState,
            activeAxisByPlotId: {
              ...nextViewerState.activeAxisByPlotId,
              [selectedAxis.plotId]: selectedAxis.axisId
            }
          };
        }
      }
      const nextRecord = {
        workspace: nextWorkspace,
        viewerState: nextViewerState,
        revision: previous.revision + 1
      };
      byDatasetPath.set(transaction.datasetPath, nextRecord);
      return {
        reason: transaction.reason,
        previous,
        next: {
          workspace: nextRecord.workspace,
          viewerState: nextRecord.viewerState,
          revision: nextRecord.revision
        }
      };
    }
  };
}

function deriveViewerInteractionState(
  workspace: WorkspaceState,
  previous?: ViewerInteractionState,
  previousWorkspace?: WorkspaceState
): ViewerInteractionState {
  const activeAxisByPlotId: Record<string, `y${number}`> = {};
  for (const plot of workspace.plots) {
    const preferredAxisId = previous?.activeAxisByPlotId?.[plot.id];
    const axisStillExists = preferredAxisId
      ? plot.axes.some((axis) => axis.id === preferredAxisId)
      : false;
    let resolvedAxisId = axisStillExists ? preferredAxisId : undefined;

    if (!resolvedAxisId && preferredAxisId) {
      const previousPlot = previousWorkspace?.plots.find((entry) => entry.id === plot.id);
      if (previousPlot) {
        const previousTraceIdsOnPreferredAxis = new Set(
          previousPlot.traces
            .filter((trace) => trace.axisId === preferredAxisId)
            .map((trace) => trace.id)
        );
        if (previousTraceIdsOnPreferredAxis.size > 0) {
          const reassignedAxisVotes = new Map<`y${number}`, number>();
          for (const trace of plot.traces) {
            if (!previousTraceIdsOnPreferredAxis.has(trace.id)) {
              continue;
            }
            reassignedAxisVotes.set(trace.axisId, (reassignedAxisVotes.get(trace.axisId) ?? 0) + 1);
          }
          const reassignedAxisId = [...reassignedAxisVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
          if (reassignedAxisId && plot.axes.some((axis) => axis.id === reassignedAxisId)) {
            resolvedAxisId = reassignedAxisId;
          }
        }
      }
    }

    if (!resolvedAxisId) {
      resolvedAxisId = plot.axes[0]?.id;
    }
    if (resolvedAxisId) {
      activeAxisByPlotId[plot.id] = resolvedAxisId;
    }
  }
  return {
    activePlotId: workspace.activePlotId,
    activeAxisByPlotId
  };
}
