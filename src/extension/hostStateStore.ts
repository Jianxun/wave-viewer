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
  mutate(workspace: WorkspaceState): WorkspaceState;
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
      const nextWorkspace = transaction.mutate(previous.workspace);
      const nextViewerState = deriveViewerInteractionState(nextWorkspace, previous.viewerState);
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
  previous?: ViewerInteractionState
): ViewerInteractionState {
  const activeAxisByPlotId: Record<string, `y${number}`> = {};
  for (const plot of workspace.plots) {
    const preferredAxisId = previous?.activeAxisByPlotId?.[plot.id];
    const axisStillExists = preferredAxisId
      ? plot.axes.some((axis) => axis.id === preferredAxisId)
      : false;
    const resolvedAxisId = axisStillExists ? preferredAxisId : plot.axes[0]?.id;
    if (resolvedAxisId) {
      activeAxisByPlotId[plot.id] = resolvedAxisId;
    }
  }
  return {
    activePlotId: workspace.activePlotId,
    activeAxisByPlotId
  };
}
