declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

import {
  createProtocolEnvelope,
  parseHostToWebviewMessage,
  type ProtocolEnvelope,
  type SidePanelTraceTuplePayload
} from "../core/dataset/types";
import { renderSignalList } from "./components/SignalList";
import { renderTabs } from "./components/Tabs";
import {
  getAxisLaneDomains,
  getPlotXBounds,
  mapLaneIndexToPlotly,
  parseRelayoutRanges,
  resolveAxisIdFromNormalizedY
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
  | ProtocolEnvelope<"host/viewerBindingUpdated", { viewerId: string; datasetPath?: string }>
  | ProtocolEnvelope<
      "host/stateSnapshot",
      {
        revision: number;
        workspace: WorkspaceState;
        viewerState: {
          activePlotId: string;
          activeAxisByPlotId: Record<string, AxisId>;
        };
      }
    >
  | ProtocolEnvelope<
      "host/statePatch",
      {
        revision: number;
        workspace: WorkspaceState;
        viewerState: {
          activePlotId: string;
          activeAxisByPlotId: Record<string, AxisId>;
        };
        reason: string;
      }
    >
  | ProtocolEnvelope<
      "host/replaySnapshot",
      {
        revision: number;
        workspace: WorkspaceState;
        viewerState: {
          activePlotId: string;
          activeAxisByPlotId: Record<string, AxisId>;
        };
        tuples: SidePanelTraceTuplePayload[];
        reason: string;
      }
    >
  | ProtocolEnvelope<"host/tupleUpsert", { tuples: SidePanelTraceTuplePayload[] }>
  | ProtocolEnvelope<
      "host/sidePanelQuickAdd",
      { signal: string; plotId?: string; axisId?: AxisId }
    >
  | ProtocolEnvelope<"host/sidePanelTraceInjected", { viewerId: string; trace: SidePanelTraceTuplePayload }>;

const vscode = acquireVsCodeApi();
installFatalErrorOverlay();

let workspace: WorkspaceState | undefined;
const traceTuplesBySourceId = new Map<string, SidePanelTraceTuplePayload>();
let viewerId = "viewer-unknown";
let nextRequestId = 1;
let lastAppliedRevision = -1;
let suppressViewportNormalization = false;

const tabsEl = getRequiredElement("plot-tabs");
const activePlotTitleEl = getRequiredElement("active-plot-title");
const refreshSignalsButtonEl = getRequiredElement<HTMLButtonElement>("refresh-signals-button");
const clearPlotButtonEl = getRequiredElement<HTMLButtonElement>("clear-plot-button");
const bridgeStatusEl = getRequiredElement("bridge-status");
const datasetStatusEl = getRequiredElement("dataset-status");
const signalListEl = getRequiredElement("signal-list");
const plotCanvasEl = getRequiredElement("plot-canvas");
const plotRootEl = getRequiredElement("plot-root");
const plotDropOverlayEl = getRequiredElement("plot-drop-overlay");

let preferredDropAxisId: AxisId | undefined;

const plotRenderer = createPlotRenderer({
  container: plotRootEl,
  onDoubleClick: () => {
    void resetActivePlotViewportAndAxes();
    return false;
  },
  onRelayout: (eventData) => {
    if (!workspace) {
      return;
    }

    const activePlot = getActivePlot(workspace);
    const updates = parseRelayoutRanges(eventData, activePlot.axes);
    if (!updates.hasChanges) {
      return;
    }

    const xBounds = getPlotXBounds({
      plot: activePlot,
      traceTuplesBySourceId
    });
    const normalizedXRange = normalizeIncomingXRange({
      eventData,
      incomingXRange: updates.xRange,
      xBounds
    });
    const shouldNormalizeViewport =
      !suppressViewportNormalization &&
      xBounds !== undefined &&
      normalizedXRange !== undefined &&
      (eventData["xaxis.autorange"] === true ||
        (updates.xRange !== undefined && !rangesEqual(updates.xRange, normalizedXRange)));

    if (updates.xRange !== undefined || "xaxis.autorange" in eventData) {
      applyRelayoutUpdate({
        type: "plot/setXRange",
        payload: { xRange: normalizedXRange }
      });
    }

    for (const axisUpdate of updates.axisRanges) {
      applyRelayoutUpdate({
        type: "axis/update",
        payload: {
          axisId: axisUpdate.axisId,
          patch: { range: axisUpdate.range }
        }
      });
    }

    if (shouldNormalizeViewport) {
      suppressViewportNormalization = true;
      void plotRenderer
        .setXViewport({
          activeRange: normalizedXRange,
          boundRange: xBounds
        })
        .finally(() => {
          suppressViewportNormalization = false;
        });
    }
  }
});

function applyRelayoutUpdate(action: WorkspaceAction): void {
  if (!workspace) {
    return;
  }

  try {
    workspace = reduceWorkspaceState(workspace, action);
  } catch (error) {
    bridgeStatusEl.textContent = `State error: ${getErrorMessage(error)}`;
  }
}

function getRequiredElement<TElement extends HTMLElement = HTMLElement>(id: string): TElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }

  return element as TElement;
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
  target: { kind: "axis"; axisId: AxisId } | { kind: "new-axis"; afterAxisId?: AxisId };
  source: "axis-row" | "canvas-overlay";
  plotId?: string;
}): void {
  if (!workspace) {
    return;
  }

  if (payload.target.kind === "axis") {
    preferredDropAxisId = payload.target.axisId;
  }

  vscode.postMessage(
    createProtocolEnvelope("webview/intent/dropSignal", {
      viewerId,
      signal: payload.signal,
      plotId: payload.plotId ?? getActivePlot(workspace).id,
      target: payload.target,
      source: payload.source,
      requestId: `${viewerId}:intent:${nextRequestId++}`
    })
  );
}

function postSetActivePlot(plotId: string): void {
  vscode.postMessage(
    createProtocolEnvelope("webview/intent/setActivePlot", {
      viewerId,
      plotId,
      requestId: `${viewerId}:intent:${nextRequestId++}`
    })
  );
}

function postAddPlot(xSignal: string): void {
  vscode.postMessage(
    createProtocolEnvelope("webview/intent/addPlot", {
      viewerId,
      xSignal,
      requestId: `${viewerId}:intent:${nextRequestId++}`
    })
  );
}

function postRemovePlot(plotId: string): void {
  vscode.postMessage(
    createProtocolEnvelope("webview/intent/removePlot", {
      viewerId,
      plotId,
      requestId: `${viewerId}:intent:${nextRequestId++}`
    })
  );
}

function postRenamePlot(plotId: string, name: string): void {
  vscode.postMessage(
    createProtocolEnvelope("webview/intent/renamePlot", {
      viewerId,
      plotId,
      name,
      requestId: `${viewerId}:intent:${nextRequestId++}`
    })
  );
}

function postSetActiveAxis(axisId: AxisId): void {
  if (!workspace) {
    return;
  }

  preferredDropAxisId = axisId;
  void renderWorkspace();

  vscode.postMessage(
    createProtocolEnvelope("webview/intent/setActiveAxis", {
      viewerId,
      plotId: getActivePlot(workspace).id,
      axisId,
      requestId: `${viewerId}:intent:${nextRequestId++}`
    })
  );
}

function postSetTraceAxis(traceId: string, axisId: AxisId): void {
  if (!workspace) {
    return;
  }

  preferredDropAxisId = axisId;
  void renderWorkspace();

  vscode.postMessage(
    createProtocolEnvelope("webview/intent/setTraceAxis", {
      viewerId,
      plotId: getActivePlot(workspace).id,
      traceId,
      axisId,
      requestId: `${viewerId}:intent:${nextRequestId++}`
    })
  );
}

function postAddAxis(afterAxisId?: AxisId): void {
  if (!workspace) {
    return;
  }

  vscode.postMessage(
    createProtocolEnvelope("webview/intent/addAxis", {
      viewerId,
      plotId: getActivePlot(workspace).id,
      afterAxisId,
      requestId: `${viewerId}:intent:${nextRequestId++}`
    })
  );
}

function postReorderAxis(axisId: AxisId, toIndex: number): void {
  if (!workspace) {
    return;
  }

  vscode.postMessage(
    createProtocolEnvelope("webview/intent/reorderAxis", {
      viewerId,
      plotId: getActivePlot(workspace).id,
      axisId,
      toIndex,
      requestId: `${viewerId}:intent:${nextRequestId++}`
    })
  );
}

function postRemoveAxisAndTraces(axisId: AxisId, traceIds: string[]): void {
  if (!workspace) {
    return;
  }

  vscode.postMessage(
    createProtocolEnvelope("webview/intent/removeAxisAndTraces", {
      viewerId,
      plotId: getActivePlot(workspace).id,
      axisId,
      traceIds,
      requestId: `${viewerId}:intent:${nextRequestId++}`
    })
  );
}

function postSetTraceVisible(traceId: string, visible: boolean): void {
  if (!workspace) {
    return;
  }

  vscode.postMessage(
    createProtocolEnvelope("webview/intent/setTraceVisible", {
      viewerId,
      plotId: getActivePlot(workspace).id,
      traceId,
      visible,
      requestId: `${viewerId}:intent:${nextRequestId++}`
    })
  );
}

function postRemoveTrace(traceId: string): void {
  if (!workspace) {
    return;
  }

  vscode.postMessage(
    createProtocolEnvelope("webview/intent/removeTrace", {
      viewerId,
      plotId: getActivePlot(workspace).id,
      traceId,
      requestId: `${viewerId}:intent:${nextRequestId++}`
    })
  );
}

function postClearPlot(plotId: string): void {
  vscode.postMessage(
    createProtocolEnvelope("webview/intent/clearPlot", {
      viewerId,
      plotId,
      requestId: `${viewerId}:intent:${nextRequestId++}`
    })
  );
}

function postRefreshSignals(): void {
  vscode.postMessage(
    createProtocolEnvelope("webview/intent/refreshSignals", {
      viewerId,
      requestId: `${viewerId}:intent:${nextRequestId++}`
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

function setCanvasDropOverlayActive(active: boolean): void {
  plotDropOverlayEl.classList.toggle("drag-active", active);
  plotDropOverlayEl.setAttribute("aria-hidden", active ? "false" : "true");
  if (!active) {
    setCanvasDropLaneActive(undefined);
  }
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

  renderTabs({
    container: tabsEl,
    plots: workspace.plots,
    activePlotId: workspace.activePlotId,
    onSelect: (plotId) => postSetActivePlot(plotId),
    onAdd: () => postAddPlot(activePlot.xSignal),
    onRename: (plotId) => {
      const plot = workspace?.plots.find((entry) => entry.id === plotId);
      if (!plot) {
        return;
      }

      const nextName = window.prompt("Rename plot", plot.name)?.trim();
      if (!nextName) {
        return;
      }
      postRenamePlot(plotId, nextName);
    },
    onRemove: (plotId) => postRemovePlot(plotId)
  });

  renderSignalList({
    container: signalListEl,
    axes: activePlot.axes,
    traces: activePlot.traces,
    activeAxisId: preferredDropAxisId,
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
    onDropTraceToNewLane: ({ traceId, afterAxisId }) => {
      if (!workspace) {
        return;
      }

      const previousActivePlot = getActivePlot(workspace);
      const previousAxisIds = new Set(previousActivePlot.axes.map((axis) => axis.id));
      workspace = reduceWorkspaceState(workspace, {
        type: "axis/add",
        payload: { afterAxisId }
      });

      const nextActivePlot = getActivePlot(workspace);
      const newAxisId = nextActivePlot.axes.find((axis) => !previousAxisIds.has(axis.id))?.id;
      if (!newAxisId) {
        void renderWorkspace();
        return;
      }

      workspace = reduceWorkspaceState(workspace, {
        type: "trace/setAxis",
        payload: { traceId, axisId: newAxisId }
      });
      preferredDropAxisId = newAxisId;
      void renderWorkspace();
      postSetActiveAxis(newAxisId);
    },
    onCreateLane: (afterAxisId) => postAddAxis(afterAxisId),
    onReorderLane: ({ axisId, toIndex }) => postReorderAxis(axisId, toIndex),
    onRemoveLane: ({ axisId, traceIds }) => postRemoveAxisAndTraces(axisId, traceIds),
    onSetAxis: (traceId, axisId) => postSetTraceAxis(traceId, axisId),
    onActivateLane: (axisId) => postSetActiveAxis(axisId),
    onSetVisible: (traceId, visible) => postSetTraceVisible(traceId, visible),
    onRemove: (traceId) => postRemoveTrace(traceId)
  });

  await plotRenderer.render(activePlot, traceTuplesBySourceId);
  renderCanvasDropOverlay(activePlot.axes);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown state update failure.";
}

function applyAuthoritativeWorkspace(payload: {
  revision: number;
  workspace: WorkspaceState;
  viewerState: {
    activePlotId: string;
    activeAxisByPlotId: Record<string, AxisId>;
  };
}, staleLogMessage: string): boolean {
  if (payload.revision <= lastAppliedRevision) {
    console.debug(staleLogMessage, {
      revision: payload.revision,
      lastAppliedRevision
    });
    return false;
  }

  lastAppliedRevision = payload.revision;
  workspace = payload.workspace;
  preferredDropAxisId = payload.viewerState.activeAxisByPlotId[payload.viewerState.activePlotId];
  return true;
}

plotCanvasEl.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer || !hasSupportedDropSignalType(event.dataTransfer)) {
    return;
  }
  event.preventDefault();
  setCanvasDropOverlayActive(true);
  setCanvasDropLaneActive(resolveAxisIdFromCanvasEvent(event));
});

plotCanvasEl.addEventListener("dragover", (event) => {
  if (!event.dataTransfer || !hasSupportedDropSignalType(event.dataTransfer)) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setCanvasDropOverlayActive(true);
  setCanvasDropLaneActive(resolveAxisIdFromCanvasEvent(event));
});

plotCanvasEl.addEventListener("dragleave", (event) => {
  const nextTarget = event.relatedTarget as Node | null;
  if (nextTarget && plotCanvasEl.contains(nextTarget)) {
    return;
  }
  setCanvasDropOverlayActive(false);
});

plotCanvasEl.addEventListener("drop", (event) => {
  setCanvasDropOverlayActive(false);

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

plotCanvasEl.tabIndex = 0;
plotCanvasEl.addEventListener("pointerdown", () => {
  plotCanvasEl.focus();
});

clearPlotButtonEl.addEventListener("click", () => {
  if (!workspace) {
    return;
  }
  postClearPlot(getActivePlot(workspace).id);
});

refreshSignalsButtonEl.addEventListener("click", () => {
  postRefreshSignals();
});

const viewportShortcutHandler = (event: KeyboardEvent) => {
  const eventWithMarker = event as KeyboardEvent & { __waveViewerHandled?: boolean };
  if (eventWithMarker.__waveViewerHandled) {
    return;
  }
  eventWithMarker.__waveViewerHandled = true;

  if (!workspace) {
    return;
  }

  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  if (isEditableTarget(event.target)) {
    return;
  }

  const activePlot = getActivePlot(workspace);
  if (event.key === "f" || event.key === "F") {
    event.preventDefault();
    void resetActivePlotViewportAndAxes();
    return;
  }

  const activeAxisId = preferredDropAxisId ?? activePlot.axes[0]?.id;
  if (!activeAxisId) {
    return;
  }
  const activeAxisIndex = activePlot.axes.findIndex((axis) => axis.id === activeAxisId);
  const yAxisLayoutKey = mapLaneIndexToPlotly(activeAxisIndex >= 0 ? activeAxisIndex : 0).layoutKey;

  if (
    event.key !== "ArrowLeft" &&
    event.key !== "ArrowRight" &&
    event.key !== "ArrowUp" &&
    event.key !== "ArrowDown"
  ) {
    return;
  }

  event.preventDefault();
  if (event.key === "ArrowLeft") {
    void panViewportOrInitialize({ direction: "left", yAxisLayoutKey });
    return;
  }
  if (event.key === "ArrowRight") {
    void panViewportOrInitialize({ direction: "right", yAxisLayoutKey });
    return;
  }
  if (event.key === "ArrowUp") {
    void panViewportOrInitialize({ direction: "up", yAxisLayoutKey });
    return;
  }
  void panViewportOrInitialize({ direction: "down", yAxisLayoutKey });
};

document.addEventListener("keydown", viewportShortcutHandler, { capture: true });
window.addEventListener("keydown", viewportShortcutHandler, { capture: true });

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const parsed = parseHostToWebviewMessage(event.data);
  if (!parsed) {
    console.debug("[wave-viewer] Ignored invalid or unknown host message.", event.data);
    return;
  }

  const message = parsed as HostMessage;

  if (message.type === "host/init") {
    bridgeStatusEl.textContent = `Connected: ${message.payload.title}`;
    if (!workspace) {
      workspace = createWorkspaceState("x");
      datasetStatusEl.textContent = "Tuple-only mode: waiting for injected traces.";
      void renderWorkspace();
    }
    return;
  }

  if (message.type === "host/viewerBindingUpdated") {
    viewerId = message.payload.viewerId;
    bridgeStatusEl.textContent = `Viewer ${message.payload.viewerId} ready for tuple traces.`;
    return;
  }

  if (message.type === "host/stateSnapshot") {
    if (
      !applyAuthoritativeWorkspace(
        message.payload,
        "[wave-viewer] Ignored stale host snapshot revision."
      )
    ) {
      return;
    }
    void renderWorkspace();
    return;
  }

  if (message.type === "host/statePatch") {
    if (
      !applyAuthoritativeWorkspace(
        message.payload,
        "[wave-viewer] Ignored stale host patch revision."
      )
    ) {
      return;
    }
    bridgeStatusEl.textContent = `Patched: ${message.payload.reason}`;
    void renderWorkspace();
    return;
  }

  if (message.type === "host/replaySnapshot") {
    if (
      !applyAuthoritativeWorkspace(
        message.payload,
        "[wave-viewer] Ignored stale host replay snapshot revision."
      )
    ) {
      return;
    }
    traceTuplesBySourceId.clear();
    for (const tuple of message.payload.tuples) {
      traceTuplesBySourceId.set(tuple.sourceId, tuple);
    }
    bridgeStatusEl.textContent = `Patched: ${message.payload.reason}`;
    void renderWorkspace();
    return;
  }

  if (message.type === "host/sidePanelQuickAdd") {
    const target =
      message.payload.plotId && message.payload.axisId
        ? { kind: "axis" as const, axisId: message.payload.axisId }
        : resolvePreferredDropTarget();
    postDropSignal({
      signal: message.payload.signal,
      target,
      source: "axis-row",
      plotId: message.payload.plotId
    });
    return;
  }

  if (message.type === "host/tupleUpsert") {
    for (const tuple of message.payload.tuples) {
      traceTuplesBySourceId.set(tuple.sourceId, tuple);
    }
    if (workspace) {
      bridgeStatusEl.textContent = "Patched: tuple upsert";
      void renderWorkspace();
    }
    return;
  }

  if (message.type === "host/sidePanelTraceInjected") {
    traceTuplesBySourceId.set(message.payload.trace.sourceId, message.payload.trace);
  }
});

vscode.postMessage(createProtocolEnvelope("webview/ready", { ready: true }));

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.matches("input, textarea, select, [contenteditable='true']") || target.isContentEditable;
}

async function resetActivePlotViewportAndAxes(): Promise<void> {
  if (!workspace) {
    return;
  }
  const activePlot = getActivePlot(workspace);
  const yAxisLayoutKeys = activePlot.axes.map((_, index) => mapLaneIndexToPlotly(index).layoutKey);
  const xBounds = getPlotXBounds({
    plot: activePlot,
    traceTuplesBySourceId
  });
  suppressViewportNormalization = true;
  try {
    await plotRenderer.resetAxes({ yAxisLayoutKeys, xRange: xBounds });
  } finally {
    suppressViewportNormalization = false;
  }
}

async function panViewportOrInitialize(payload: {
  direction: "left" | "right" | "up" | "down";
  yAxisLayoutKey: string;
}): Promise<void> {
  const didPan = await plotRenderer.pan(payload);
  if (didPan || !workspace) {
    return;
  }

  if (payload.direction === "left" || payload.direction === "right") {
    const activePlot = getActivePlot(workspace);
    const xBounds = getPlotXBounds({
      plot: activePlot,
      traceTuplesBySourceId
    });
    if (!xBounds) {
      return;
    }

    suppressViewportNormalization = true;
    try {
      await plotRenderer.setXViewport({
        activeRange: xBounds,
        boundRange: xBounds
      });
    } finally {
      suppressViewportNormalization = false;
    }
    await plotRenderer.pan(payload);
  }
}

function normalizeIncomingXRange(payload: {
  eventData: Record<string, unknown>;
  incomingXRange?: [number, number];
  xBounds?: [number, number];
}): [number, number] | undefined {
  if (!payload.xBounds) {
    return payload.incomingXRange;
  }
  if (payload.eventData["xaxis.autorange"] === true) {
    return payload.xBounds;
  }
  if (!payload.incomingXRange) {
    return payload.incomingXRange;
  }
  return clampRangeToBounds(payload.incomingXRange, payload.xBounds);
}

function clampRangeToBounds(range: [number, number], bounds: [number, number]): [number, number] {
  const [boundStart, boundEnd] = bounds;
  const width = range[1] - range[0];
  const boundWidth = boundEnd - boundStart;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(boundWidth) || boundWidth <= 0) {
    return bounds;
  }
  if (width >= boundWidth) {
    return bounds;
  }

  const clampedStart = Math.min(Math.max(range[0], boundStart), boundEnd - width);
  return [clampedStart, clampedStart + width];
}

function rangesEqual(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function installFatalErrorOverlay(): void {
  window.addEventListener("error", (event) => {
    renderFatalError(`Webview startup error: ${event.message}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason =
      event.reason instanceof Error
        ? event.reason.message
        : typeof event.reason === "string"
          ? event.reason
          : "Unknown promise rejection";
    renderFatalError(`Webview startup error: ${reason}`);
  });
}

function renderFatalError(message: string): void {
  console.error("[wave-viewer] fatal webview error", message);
  const body = document.body;
  if (!body) {
    return;
  }
  body.innerHTML = `<pre style="white-space: pre-wrap; margin: 16px; color: #e8edf8; background: #101723; border: 1px solid #4864a5; border-radius: 8px; padding: 12px;">${escapeHtml(
    message
  )}</pre>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
