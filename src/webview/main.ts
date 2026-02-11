declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

import { renderAxisManager } from "./components/AxisManager";
import { renderSignalList } from "./components/SignalList";
import { renderTabs } from "./components/Tabs";
import { renderTraceList } from "./components/TraceList";
import { parseRelayoutRanges, type DatasetColumnData } from "./plotly/adapter";
import { createPlotRenderer } from "./plotly/renderPlot";
import { reduceWorkspaceState, type WorkspaceAction } from "./state/reducer";
import {
  createWorkspaceState,
  getActivePlot,
  type WorkspaceState
} from "./state/workspaceState";

type HostMessage =
  | { type: "host/init"; payload: { title: string } }
  | {
      type: "host/datasetLoaded";
      payload: {
        path: string;
        fileName: string;
        rowCount: number;
        columns: Array<{ name: string; values: number[] }>;
        defaultXSignal: string;
      };
    }
  | {
      type: "host/workspaceLoaded";
      payload: { workspace: WorkspaceState };
    };

const vscode = acquireVsCodeApi();

let workspace: WorkspaceState | undefined;
let signalNames: string[] = [];
let columns: DatasetColumnData[] = [];

const tabsEl = getRequiredElement("plot-tabs");
const activePlotTitleEl = getRequiredElement("active-plot-title");
const bridgeStatusEl = getRequiredElement("bridge-status");
const datasetStatusEl = getRequiredElement("dataset-status");
const xSignalSelectEl = getRequiredElement<HTMLSelectElement>("x-signal-select");
const signalListEl = getRequiredElement("signal-list");
const traceListEl = getRequiredElement("trace-list");
const axisManagerEl = getRequiredElement("axis-manager");
const plotCanvasEl = getRequiredElement("plot-canvas");

const plotRenderer = createPlotRenderer({
  container: plotCanvasEl,
  onRelayout: (eventData) => {
    if (!workspace) {
      return;
    }

    const activePlot = getActivePlot(workspace);
    const updates = parseRelayoutRanges(eventData, activePlot.axes);
    if (!updates.hasChanges) {
      return;
    }

    if (updates.xRange !== undefined || "xaxis.autorange" in eventData) {
      dispatch({
        type: "plot/setXRange",
        payload: { xRange: updates.xRange }
      });
    }

    for (const axisUpdate of updates.axisRanges) {
      dispatch({
        type: "axis/update",
        payload: {
          axisId: axisUpdate.axisId,
          patch: { range: axisUpdate.range }
        }
      });
    }
  }
});

function getRequiredElement<TElement extends HTMLElement = HTMLElement>(id: string): TElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }

  return element as TElement;
}

function dispatch(action: WorkspaceAction): void {
  if (!workspace) {
    return;
  }

  try {
    workspace = reduceWorkspaceState(workspace, action);
    void renderWorkspace();
  } catch (error) {
    bridgeStatusEl.textContent = `State error: ${getErrorMessage(error)}`;
  }
}

async function renderWorkspace(): Promise<void> {
  if (!workspace) {
    return;
  }

  const activePlot = getActivePlot(workspace);
  activePlotTitleEl.textContent = activePlot.name;
  renderXSignalSelector(activePlot.xSignal);

  renderTabs({
    container: tabsEl,
    plots: workspace.plots,
    activePlotId: workspace.activePlotId,
    onSelect: (plotId) => dispatch({ type: "plot/setActive", payload: { plotId } }),
    onAdd: () =>
      dispatch({
        type: "plot/add",
        payload: { xSignal: activePlot.xSignal }
      }),
    onRename: (plotId) => {
      const plot = workspace?.plots.find((entry) => entry.id === plotId);
      if (!plot) {
        return;
      }

      const nextName = window.prompt("Rename plot", plot.name);
      if (!nextName) {
        return;
      }
      dispatch({ type: "plot/rename", payload: { plotId, name: nextName } });
    },
    onRemove: (plotId) => dispatch({ type: "plot/remove", payload: { plotId } })
  });

  renderSignalList({
    container: signalListEl,
    signals: signalNames,
    axes: activePlot.axes,
    onAddTrace: ({ signal, axisChoice }) => {
      if (axisChoice === "create-new") {
        dispatch({ type: "axis/add" });
        const refreshed = workspace ? getActivePlot(workspace) : undefined;
        const newestAxis = refreshed?.axes[refreshed.axes.length - 1]?.id;
        if (!newestAxis) {
          return;
        }
        dispatch({ type: "trace/add", payload: { signal, axisId: newestAxis } });
        return;
      }

      dispatch({ type: "trace/add", payload: { signal, axisId: axisChoice } });
    }
  });

  renderTraceList({
    container: traceListEl,
    traces: activePlot.traces,
    axes: activePlot.axes,
    onSetAxis: (traceId, axisId) => dispatch({ type: "trace/setAxis", payload: { traceId, axisId } }),
    onSetVisible: (traceId, visible) =>
      dispatch({ type: "trace/setVisible", payload: { traceId, visible } }),
    onRemove: (traceId) => dispatch({ type: "trace/remove", payload: { traceId } })
  });

  renderAxisManager({
    container: axisManagerEl,
    axes: activePlot.axes,
    onAddAxis: () => dispatch({ type: "axis/add" }),
    onRemoveAxis: ({ axisId, reassignToAxisId }) =>
      dispatch({ type: "axis/remove", payload: { axisId, reassignToAxisId } }),
    onReassignTraces: ({ fromAxisId, toAxisId }) =>
      dispatch({ type: "axis/reassignTraces", payload: { fromAxisId, toAxisId } }),
    onUpdateAxis: ({ axisId, patch }) =>
      dispatch({
        type: "axis/update",
        payload: {
          axisId,
          patch
        }
      })
  });

  await plotRenderer.render(activePlot, columns);
  vscode.postMessage({
    type: "webview/workspaceChanged",
    payload: { workspace }
  });
}

function renderXSignalSelector(activeXSignal: string): void {
  xSignalSelectEl.replaceChildren();

  for (const signalName of signalNames) {
    xSignalSelectEl.add(new Option(signalName, signalName, signalName === activeXSignal));
  }

  if (xSignalSelectEl.value !== activeXSignal && signalNames.includes(activeXSignal)) {
    xSignalSelectEl.value = activeXSignal;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown state update failure.";
}

xSignalSelectEl.addEventListener("change", () => {
  if (!workspace || !xSignalSelectEl.value) {
    return;
  }

  dispatch({ type: "plot/setXSignal", payload: { xSignal: xSignalSelectEl.value } });
});

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;

  if (message.type === "host/init") {
    bridgeStatusEl.textContent = `Connected: ${message.payload.title}`;
    return;
  }

  if (message.type === "host/datasetLoaded") {
    columns = message.payload.columns;
    signalNames = message.payload.columns.map((column) => column.name);
    const initialXSignal = signalNames.includes(message.payload.defaultXSignal)
      ? message.payload.defaultXSignal
      : signalNames[0] ?? "";

    if (!initialXSignal) {
      datasetStatusEl.textContent = `Loaded ${message.payload.fileName} but no numeric signals were provided.`;
      return;
    }

    workspace = createWorkspaceState(initialXSignal);
    datasetStatusEl.textContent = `Loaded ${message.payload.fileName} (${message.payload.rowCount} rows)`;
    void renderWorkspace();
    return;
  }

  if (message.type === "host/workspaceLoaded") {
    workspace = message.payload.workspace;
    void renderWorkspace();
  }
});

vscode.postMessage({ type: "webview/ready" });
