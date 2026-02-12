import type { ViewerSessionRegistry, WebviewPanelLike, ViewerSessionRoute } from "./types";

function toFallbackLayoutUri(datasetPath: string): string {
  return `${datasetPath}.wave-viewer.yaml`;
}

export function createViewerSessionRegistry(): ViewerSessionRegistry {
  type ViewerSession = {
    panel: WebviewPanelLike;
    datasetPath?: string;
    layoutUri?: string;
    focusOrder: number;
  };

  let nextViewerNumber = 1;
  let nextFocusOrder = 1;
  let activeViewerId: string | undefined;
  const viewerById = new Map<string, ViewerSession>();
  const viewerIdsByDatasetPath = new Map<string, Set<string>>();

  function removeDatasetIndex(datasetPath: string, viewerId: string): void {
    const viewerIds = viewerIdsByDatasetPath.get(datasetPath);
    if (!viewerIds) {
      return;
    }
    viewerIds.delete(viewerId);
    if (viewerIds.size === 0) {
      viewerIdsByDatasetPath.delete(datasetPath);
    }
  }

  function addDatasetIndex(datasetPath: string, viewerId: string): void {
    const viewerIds = viewerIdsByDatasetPath.get(datasetPath) ?? new Set<string>();
    viewerIds.add(viewerId);
    viewerIdsByDatasetPath.set(datasetPath, viewerIds);
  }

  function pickMostRecentlyFocusedViewerId(viewerIds: Iterable<string>): string | undefined {
    let selectedViewerId: string | undefined;
    let selectedFocusOrder = -1;
    for (const viewerId of viewerIds) {
      const session = viewerById.get(viewerId);
      if (!session) {
        continue;
      }
      if (session.focusOrder > selectedFocusOrder) {
        selectedFocusOrder = session.focusOrder;
        selectedViewerId = viewerId;
      }
    }
    return selectedViewerId;
  }

  function getSession(viewerId: string): ViewerSession | undefined {
    return viewerById.get(viewerId);
  }

  const registry: ViewerSessionRegistry = {
    registerPanel(panel: WebviewPanelLike, datasetPath?: string): string {
      const viewerId = `viewer-${nextViewerNumber++}`;
      viewerById.set(viewerId, {
        panel,
        datasetPath,
        layoutUri: datasetPath ? toFallbackLayoutUri(datasetPath) : undefined,
        focusOrder: nextFocusOrder++
      });
      if (datasetPath) {
        addDatasetIndex(datasetPath, viewerId);
      }
      activeViewerId = viewerId;
      panel.onDidDispose?.(() => {
        registry.removeViewer(viewerId);
      });
      panel.onDidChangeViewState?.((event) => {
        if (event.active) {
          registry.markViewerFocused(viewerId);
        }
      });
      return viewerId;
    },
    bindViewerToDataset(viewerId: string, datasetPath: string): void {
      const session = getSession(viewerId);
      if (!session) {
        return;
      }
      if (session.datasetPath === datasetPath) {
        return;
      }
      if (session.datasetPath) {
        removeDatasetIndex(session.datasetPath, viewerId);
      }
      session.datasetPath = datasetPath;
      session.layoutUri = toFallbackLayoutUri(datasetPath);
      addDatasetIndex(datasetPath, viewerId);
    },
    bindViewerToLayout(viewerId: string, layoutUri: string, datasetPath: string): void {
      const session = getSession(viewerId);
      if (!session) {
        return;
      }
      if (session.datasetPath !== datasetPath) {
        if (session.datasetPath) {
          removeDatasetIndex(session.datasetPath, viewerId);
        }
        session.datasetPath = datasetPath;
        addDatasetIndex(datasetPath, viewerId);
      }
      session.layoutUri = layoutUri;
    },
    getDatasetPathForViewer(viewerId: string): string | undefined {
      return getSession(viewerId)?.datasetPath;
    },
    getViewerSessionContext(viewerId: string) {
      const session = getSession(viewerId);
      if (!session?.datasetPath || !session.layoutUri) {
        return undefined;
      }
      return {
        datasetPath: session.datasetPath,
        layoutUri: session.layoutUri
      };
    },
    getPanelForViewer(viewerId: string): WebviewPanelLike | undefined {
      return getSession(viewerId)?.panel;
    },
    markViewerFocused(viewerId: string): void {
      const session = getSession(viewerId);
      if (!session) {
        return;
      }
      activeViewerId = viewerId;
      session.focusOrder = nextFocusOrder++;
    },
    removeViewer(viewerId: string): void {
      const session = getSession(viewerId);
      if (!session) {
        return;
      }
      if (session.datasetPath) {
        removeDatasetIndex(session.datasetPath, viewerId);
      }
      viewerById.delete(viewerId);

      if (activeViewerId !== viewerId) {
        return;
      }
      activeViewerId = pickMostRecentlyFocusedViewerId(viewerById.keys());
    },
    resolveTargetViewerSession(datasetPath: string): ViewerSessionRoute | undefined {
      const activeSession = activeViewerId ? getSession(activeViewerId) : undefined;
      if (activeSession && activeViewerId && activeSession.datasetPath === datasetPath) {
        return { viewerId: activeViewerId, panel: activeSession.panel, bindDataset: false };
      }

      if (activeSession && activeViewerId && !activeSession.datasetPath) {
        return { viewerId: activeViewerId, panel: activeSession.panel, bindDataset: true };
      }

      const datasetViewerIds = viewerIdsByDatasetPath.get(datasetPath);
      if (!datasetViewerIds || datasetViewerIds.size === 0) {
        return undefined;
      }

      const targetViewerId = pickMostRecentlyFocusedViewerId(datasetViewerIds);
      if (!targetViewerId) {
        return undefined;
      }
      const targetSession = getSession(targetViewerId);
      if (!targetSession) {
        return undefined;
      }
      return { viewerId: targetViewerId, panel: targetSession.panel, bindDataset: false };
    },
    hasOpenPanelForDataset(datasetPath: string): boolean {
      return (viewerIdsByDatasetPath.get(datasetPath)?.size ?? 0) > 0;
    },
    getPanelForDataset(datasetPath: string): WebviewPanelLike | undefined {
      const target = registry.resolveTargetViewerSession(datasetPath);
      return target && !target.bindDataset ? target.panel : undefined;
    },
    getActiveViewerId(): string | undefined {
      return activeViewerId;
    }
  };

  return registry;
}
