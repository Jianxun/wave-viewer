declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

import {
  createProtocolEnvelope,
  parseHostToWebviewMessage,
  type ProtocolEnvelope
} from "../core/dataset/types";
import { renderAxisManager } from "./components/AxisManager";
import { renderSignalList } from "./components/SignalList";
import { renderTabs } from "./components/Tabs";
import { renderTraceList } from "./components/TraceList";
import {
  getAxisLaneDomains,
  parseRelayoutRanges,
  resolveAxisIdFromNormalizedY,
  type DatasetColumnData
} from "./plotly/adapter";
import { createPlotRenderer } from "./plotly/renderPlot";
import { reduceWorkspaceState, type WorkspaceAction } from "./state/reducer";
import {
  type AxisId,
  createWorkspaceState,
  getActivePlot,
  type WorkspaceState
} from "./state/workspaceState";
import { extractSignalFromDropData, hasSupportedDropSignalType } from "./dropSignal";

type HostMessage =
  | ProtocolEnvelope<"host/init", { title: string }>
  | ProtocolEnvelope<
      "host/datasetLoaded",
      {
        path: string;
        fileName: string;
        rowCount: number;
        columns: Array<{ name: string; values: number[] }>;
        defaultXSignal: string;
      }
    >
  | ProtocolEnvelope<"host/workspaceLoaded", { workspace: WorkspaceState }>
  | ProtocolEnvelope<"host/workspacePatched", { workspace: WorkspaceState; reason: string }>;

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
const plotRootEl = getRequiredElement("plot-root");
const plotDropOverlayEl = getRequiredElement("plot-drop-overlay");

let preferredDropAxisId: AxisId | undefined;

const plotRenderer = createPlotRenderer({
  container: plotRootEl,
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

function resolvePreferredDropTarget(): { kind: "axis"; axisId: AxisId } | { kind: "new-axis" } {
  if (!workspace) {
    return { kind: "new-axis" };
  }

  const activePlot = getActivePlot(workspace);
  if (activePlot.axes.length === 0) {
    return { kind: "new-axis" };
  }

  const preferred = activePlot.axes.find((axis) => axis.id === preferredDropAxisId)?.id;
  if (preferred) {
    return { kind: "axis", axisId: preferred };
  }

  return { kind: "axis", axisId: activePlot.axes[0].id };
}

function postDropSignal(payload: {
  signal: string;
  target: { kind: "axis"; axisId: AxisId } | { kind: "new-axis" };
  source: "axis-row" | "canvas-overlay";
}): void {
  if (!workspace) {
    return;
  }

  if (payload.target.kind === "axis") {
    preferredDropAxisId = payload.target.axisId;
  }

  vscode.postMessage(
    createProtocolEnvelope("webview/dropSignal", {
      signal: payload.signal,
      plotId: getActivePlot(workspace).id,
      target: payload.target,
      source: payload.source
    })
  );
}

function renderCanvasDropOverlay(axes: ReadonlyArray<{ id: AxisId }>): void {
  plotDropOverlayEl.replaceChildren();
  const laneDomains = getAxisLaneDomains(axes);

  for (const lane of laneDomains) {
    const laneEl = document.createElement("div");
    laneEl.className = "plot-drop-lane";
    laneEl.dataset.axisId = lane.axisId;
    laneEl.style.top = `${(1 - lane.domain[1]) * 100}%`;
    laneEl.style.height = `${(lane.domain[1] - lane.domain[0]) * 100}%`;
    plotDropOverlayEl.appendChild(laneEl);
  }
}

function setCanvasDropLaneActive(axisId: AxisId | undefined): void {
  const lanes = plotDropOverlayEl.querySelectorAll<HTMLElement>(".plot-drop-lane");
  lanes.forEach((lane) => {
    lane.classList.toggle("drop-active", lane.dataset.axisId === axisId);
  });
}

function resolveAxisIdFromCanvasEvent(event: DragEvent): AxisId | undefined {
  if (!workspace) {
    return undefined;
  }

  const rect = plotCanvasEl.getBoundingClientRect();
  if (rect.height <= 0) {
    return undefined;
  }

  const ratioFromTop = (event.clientY - rect.top) / rect.height;
  const normalizedY = 1 - Math.max(0, Math.min(1, ratioFromTop));
  const activePlot = getActivePlot(workspace);
  return resolveAxisIdFromNormalizedY(activePlot.axes, normalizedY);
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
    },
    onQuickAdd: ({ signal }) => {
      postDropSignal({
        signal,
        target: resolvePreferredDropTarget(),
        source: "axis-row"
      });
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
    canDropSignal: (event) => {
      if (!event.dataTransfer) {
        return false;
      }
      return hasSupportedDropSignalType(event.dataTransfer);
    },
    parseDroppedSignal: (event) => {
      if (!event.dataTransfer) {
        return undefined;
      }
      return extractSignalFromDropData(event.dataTransfer);
    },
    onDropSignal: ({ signal, target }) => {
      postDropSignal({
        signal,
        target,
        source: "axis-row"
      });
    },
    onAddAxis: () => dispatch({ type: "axis/add" }),
    onReorderAxis: ({ axisId, toIndex }) =>
      dispatch({ type: "axis/reorder", payload: { axisId, toIndex } }),
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
  renderCanvasDropOverlay(activePlot.axes);
  vscode.postMessage(
    createProtocolEnvelope("webview/workspaceChanged", {
      workspace,
      reason: "reducer-dispatch"
    })
  );
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

plotCanvasEl.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer || !hasSupportedDropSignalType(event.dataTransfer)) {
    return;
  }
  event.preventDefault();
});

plotCanvasEl.addEventListener("dragover", (event) => {
  if (!event.dataTransfer || !hasSupportedDropSignalType(event.dataTransfer)) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setCanvasDropLaneActive(resolveAxisIdFromCanvasEvent(event));
});

plotCanvasEl.addEventListener("dragleave", (event) => {
  const nextTarget = event.relatedTarget as Node | null;
  if (nextTarget && plotCanvasEl.contains(nextTarget)) {
    return;
  }
  setCanvasDropLaneActive(undefined);
});

plotCanvasEl.addEventListener("drop", (event) => {
  setCanvasDropLaneActive(undefined);

  if (!event.dataTransfer) {
    return;
  }

  const signal = extractSignalFromDropData(event.dataTransfer);
  const axisId = resolveAxisIdFromCanvasEvent(event);
  if (!signal || !axisId) {
    return;
  }

  event.preventDefault();
  postDropSignal({
    signal,
    target: { kind: "axis", axisId },
    source: "canvas-overlay"
  });
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const parsed = parseHostToWebviewMessage(event.data);
  if (!parsed) {
    console.debug("[wave-viewer] Ignored invalid or unknown host message.", event.data);
    return;
  }

  const message = parsed as HostMessage;

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
    return;
  }

  if (message.type === "host/workspacePatched") {
    workspace = message.payload.workspace;
    bridgeStatusEl.textContent = `Patched: ${message.payload.reason}`;
    void renderWorkspace();
  }
});

vscode.postMessage(createProtocolEnvelope("webview/ready", { ready: true }));
