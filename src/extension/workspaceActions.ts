import { reduceWorkspaceState } from "../webview/state/reducer";
import type { WorkspaceState } from "../webview/state/workspaceState";
import type { SidePanelSignalAction, WebviewToHostMessage } from "./types";

export function applySidePanelSignalAction(
  workspace: WorkspaceState,
  action: SidePanelSignalAction,
  options?: { sourceId?: string; axisId?: `y${number}`; afterAxisId?: `y${number}` }
): WorkspaceState {
  if (action.type === "add-to-plot") {
    const currentPlot = workspace.plots.find((plot) => plot.id === workspace.activePlotId);
    const needsAxis = !currentPlot || currentPlot.axes.length === 0;
    const workspaceWithAxis = needsAxis
      ? reduceWorkspaceState(workspace, { type: "axis/add" })
      : workspace;
    const activePlot = workspaceWithAxis.plots.find(
      (plot) => plot.id === workspaceWithAxis.activePlotId
    );
    const requestedAxisExists =
      options?.axisId !== undefined &&
      (activePlot?.axes.some((axis) => axis.id === options.axisId) ?? false);
    const fallbackAxisId = activePlot?.axes[0]?.id;
    return reduceWorkspaceState(workspaceWithAxis, {
      type: "trace/add",
      payload: {
        signal: action.signal,
        sourceId: options?.sourceId,
        axisId: requestedAxisExists ? options?.axisId : fallbackAxisId
      }
    });
  }

  if (action.type === "add-to-new-axis") {
    const withAxis = reduceWorkspaceState(workspace, {
      type: "axis/add",
      payload: { afterAxisId: options?.afterAxisId }
    });
    const axisId = findAddedAxisId(workspace, withAxis, withAxis.activePlotId);
    if (axisId === undefined) {
      return withAxis;
    }
    return reduceWorkspaceState(withAxis, {
      type: "trace/add",
      payload: { signal: action.signal, sourceId: options?.sourceId, axisId }
    });
  }

  const revealPlot = workspace.plots.find((plot) =>
    plot.traces.some((trace) => trace.signal === action.signal)
  );
  if (!revealPlot) {
    return workspace;
  }

  let revealed = reduceWorkspaceState(workspace, {
    type: "plot/setActive",
    payload: { plotId: revealPlot.id }
  });

  for (const trace of revealPlot.traces) {
    if (trace.signal !== action.signal || trace.visible) {
      continue;
    }
    revealed = reduceWorkspaceState(revealed, {
      type: "trace/setVisible",
      payload: { traceId: trace.id, visible: true }
    });
  }

  return revealed;
}

export function applyDropSignalAction(
  workspace: WorkspaceState,
  payload: Extract<WebviewToHostMessage, { type: "webview/intent/dropSignal" }>["payload"],
  options?: { sourceId?: string }
): WorkspaceState {
  let nextWorkspace = reduceWorkspaceState(workspace, {
    type: "plot/setActive",
    payload: { plotId: payload.plotId }
  });

  if (payload.target.kind === "new-axis") {
    nextWorkspace = reduceWorkspaceState(nextWorkspace, {
      type: "axis/add",
      payload: { plotId: payload.plotId, afterAxisId: payload.target.afterAxisId }
    });
    const newAxisId = findAddedAxisId(workspace, nextWorkspace, payload.plotId);
    if (newAxisId === undefined) {
      return nextWorkspace;
    }

    return reduceWorkspaceState(nextWorkspace, {
      type: "trace/add",
      payload: {
        plotId: payload.plotId,
        signal: payload.signal,
        sourceId: options?.sourceId,
        axisId: newAxisId
      }
    });
  }

  if (!isAxisId(payload.target.axisId)) {
    throw new Error(`Invalid dropSignal axis id: ${payload.target.axisId}`);
  }

  return reduceWorkspaceState(nextWorkspace, {
    type: "trace/add",
    payload: {
      plotId: payload.plotId,
      signal: payload.signal,
      sourceId: options?.sourceId,
      axisId: payload.target.axisId
    }
  });
}

function isAxisId(value: string): value is `y${number}` {
  return /^y\d+$/.test(value);
}

function findAddedAxisId(
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
