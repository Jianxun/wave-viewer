export type DatasetColumn = {
  name: string;
  values: number[];
};

export type Dataset = {
  path: string;
  rowCount: number;
  columns: DatasetColumn[];
};

export type DatasetMetadata = {
  path: string;
  rowCount: number;
  columns: Array<{ name: string }>;
};

export type SidePanelTraceTuplePayload = {
  traceId: string;
  sourceId: string;
  datasetPath: string;
  xName: string;
  yName: string;
  x: number[];
  y: number[];
};

export const PROTOCOL_VERSION = 2 as const;

export type ProtocolEnvelope<TType extends string, TPayload> = {
  version: typeof PROTOCOL_VERSION;
  type: TType;
  payload: TPayload;
};

export type HostToWebviewMessageType =
  | "host/init"
  | "host/viewerBindingUpdated"
  | "host/datasetLoaded"
  | "host/stateSnapshot"
  | "host/statePatch"
  | "host/tupleUpsert"
  | "host/sidePanelQuickAdd"
  | "host/sidePanelTraceInjected";

export type WebviewToHostMessageType =
  | "webview/ready"
  | "webview/intent/setActivePlot"
  | "webview/intent/setActiveAxis"
  | "webview/intent/dropSignal"
  | "webview/intent/addSignalToActiveAxis"
  | "webview/intent/addSignalToNewAxis"
  | "webview/dropSignal"
  | "webview/command";

export type ParsedHostToWebviewMessage =
  | ProtocolEnvelope<"host/init", { title: string }>
  | ProtocolEnvelope<"host/viewerBindingUpdated", { viewerId: string; datasetPath?: string }>
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
  | ProtocolEnvelope<
      "host/stateSnapshot",
      { revision: number; workspace: WorkspaceStateLike; viewerState: ViewerStateLike }
    >
  | ProtocolEnvelope<
      "host/statePatch",
      { revision: number; workspace: WorkspaceStateLike; viewerState: ViewerStateLike; reason: string }
    >
  | ProtocolEnvelope<"host/tupleUpsert", { tuples: SidePanelTraceTuplePayload[] }>
  | ProtocolEnvelope<"host/sidePanelQuickAdd", { signal: string }>
  | ProtocolEnvelope<
    "host/sidePanelTraceInjected",
    { viewerId: string; trace: SidePanelTraceTuplePayload }
  >;

export type ParsedWebviewToHostMessage =
  | ProtocolEnvelope<"webview/ready", Record<string, unknown>>
  | ProtocolEnvelope<
      "webview/intent/setActivePlot",
      { viewerId: string; plotId: string; requestId: string }
    >
  | ProtocolEnvelope<
      "webview/intent/setActiveAxis",
      { viewerId: string; plotId: string; axisId: string; requestId: string }
    >
  | ProtocolEnvelope<
      "webview/intent/dropSignal",
      {
        viewerId: string;
        signal: string;
        plotId: string;
        target: { kind: "axis"; axisId: string } | { kind: "new-axis" };
        source: "axis-row" | "canvas-overlay";
        requestId: string;
      }
    >
  | ProtocolEnvelope<
      "webview/intent/addSignalToActiveAxis",
      { viewerId: string; signal: string; requestId: string }
    >
  | ProtocolEnvelope<
      "webview/intent/addSignalToNewAxis",
      { viewerId: string; signal: string; requestId: string }
    >
  | ProtocolEnvelope<
      "webview/dropSignal",
      {
        signal: string;
        plotId: string;
        target: { kind: "axis"; axisId: string } | { kind: "new-axis" };
        source: "axis-row" | "canvas-overlay";
      }
    >
  | ProtocolEnvelope<
      "webview/command",
      {
        command: "zoomToFit" | "cancelGesture" | "revealSignal";
        args?: Record<string, unknown>;
      }
    >;

type WorkspaceStateLike = {
  activePlotId: string;
  plots: Array<{
    id: string;
    name: string;
    xSignal: string;
    axes: Array<{
      id: `y${number}` | string;
      side?: "left" | "right";
      title?: string;
      range?: [number, number];
      scale?: "linear" | "log";
    }>;
    traces: Array<{
      id: string;
      signal: string;
      sourceId?: string;
      axisId: `y${number}` | string;
      visible: boolean;
      color?: string;
      lineWidth?: number;
    }>;
    nextAxisNumber: number;
    xRange?: [number, number];
  }>;
};

type ViewerStateLike = {
  activePlotId: string;
  activeAxisByPlotId: Record<string, `y${number}` | string>;
};

export function createProtocolEnvelope<TType extends string, TPayload>(
  type: TType,
  payload: TPayload
): ProtocolEnvelope<TType, TPayload> {
  return {
    version: PROTOCOL_VERSION,
    type,
    payload
  };
}

export function parseHostToWebviewMessage(
  value: unknown
): ParsedHostToWebviewMessage | undefined {
  if (!isEnvelope(value) || !isHostMessageType(value.type)) {
    return undefined;
  }

  if (!isValidHostPayload(value.type, value.payload)) {
    return undefined;
  }

  return value as ParsedHostToWebviewMessage;
}

export function parseWebviewToHostMessage(
  value: unknown
): ParsedWebviewToHostMessage | undefined {
  if (!isEnvelope(value) || !isWebviewMessageType(value.type)) {
    return undefined;
  }

  if (!isValidWebviewPayload(value.type, value.payload)) {
    return undefined;
  }

  return value as ParsedWebviewToHostMessage;
}

function isEnvelope(value: unknown): value is ProtocolEnvelope<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  if (value.version !== PROTOCOL_VERSION) {
    return false;
  }

  return typeof value.type === "string" && "payload" in value;
}

function isHostMessageType(type: string): type is HostToWebviewMessageType {
  return (
    type === "host/init" ||
    type === "host/viewerBindingUpdated" ||
    type === "host/datasetLoaded" ||
    type === "host/stateSnapshot" ||
    type === "host/statePatch" ||
    type === "host/tupleUpsert" ||
    type === "host/sidePanelQuickAdd" ||
    type === "host/sidePanelTraceInjected"
  );
}

function isWebviewMessageType(type: string): type is WebviewToHostMessageType {
  return (
    type === "webview/ready" ||
    type === "webview/intent/setActivePlot" ||
    type === "webview/intent/setActiveAxis" ||
    type === "webview/intent/dropSignal" ||
    type === "webview/intent/addSignalToActiveAxis" ||
    type === "webview/intent/addSignalToNewAxis" ||
    type === "webview/dropSignal" ||
    type === "webview/command"
  );
}

function isValidHostPayload(type: HostToWebviewMessageType, payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  if (type === "host/init") {
    return isNonEmptyString(payload.title);
  }

  if (type === "host/viewerBindingUpdated") {
    return (
      isNonEmptyString(payload.viewerId) &&
      (payload.datasetPath === undefined || isNonEmptyString(payload.datasetPath))
    );
  }

  if (type === "host/datasetLoaded") {
    return (
      typeof payload.path === "string" &&
      typeof payload.fileName === "string" &&
      typeof payload.rowCount === "number" &&
      Number.isFinite(payload.rowCount) &&
      typeof payload.defaultXSignal === "string" &&
      Array.isArray(payload.columns) &&
      payload.columns.every(
        (column) =>
          isRecord(column) &&
          typeof column.name === "string" &&
          Array.isArray(column.values) &&
          column.values.every((entry) => typeof entry === "number" && Number.isFinite(entry))
      )
    );
  }

  if (type === "host/stateSnapshot" || type === "host/statePatch") {
    const hasPatchReason = type === "host/statePatch";
    return (
      isNonNegativeInteger(payload.revision) &&
      isWorkspaceStateLike(payload.workspace) &&
      isViewerStateLike(payload.viewerState) &&
      (!hasPatchReason || typeof payload.reason === "string")
    );
  }

  if (type === "host/tupleUpsert") {
    return Array.isArray(payload.tuples) && payload.tuples.every((tuple) => isSidePanelTraceTuplePayload(tuple));
  }

  if (type === "host/sidePanelQuickAdd") {
    return isNonEmptyString(payload.signal);
  }

  if (type === "host/sidePanelTraceInjected") {
    return isNonEmptyString(payload.viewerId) && isSidePanelTraceTuplePayload(payload.trace);
  }

  return isWorkspaceStateLike(payload.workspace);
}

function isValidWebviewPayload(type: WebviewToHostMessageType, payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  if (type === "webview/ready") {
    return true;
  }

  if (
    type === "webview/intent/setActivePlot" ||
    type === "webview/intent/addSignalToActiveAxis" ||
    type === "webview/intent/addSignalToNewAxis"
  ) {
    return (
      isNonEmptyString(payload.viewerId) &&
      isNonEmptyString(payload.requestId) &&
      (type === "webview/intent/setActivePlot" ? isNonEmptyString(payload.plotId) : isNonEmptyString(payload.signal))
    );
  }

  if (type === "webview/intent/setActiveAxis") {
    return (
      isNonEmptyString(payload.viewerId) &&
      isNonEmptyString(payload.plotId) &&
      isNonEmptyString(payload.axisId) &&
      isNonEmptyString(payload.requestId)
    );
  }

  if (type === "webview/intent/dropSignal") {
    if (
      !isNonEmptyString(payload.viewerId) ||
      !isNonEmptyString(payload.requestId) ||
      typeof payload.signal !== "string" ||
      typeof payload.plotId !== "string" ||
      !isRecord(payload.target) ||
      (payload.source !== "axis-row" && payload.source !== "canvas-overlay")
    ) {
      return false;
    }

    if (payload.target.kind === "axis") {
      return typeof payload.target.axisId === "string";
    }

    return payload.target.kind === "new-axis";
  }

  if (type === "webview/dropSignal") {
    if (
      typeof payload.signal !== "string" ||
      typeof payload.plotId !== "string" ||
      !isRecord(payload.target) ||
      (payload.source !== "axis-row" && payload.source !== "canvas-overlay")
    ) {
      return false;
    }

    if (payload.target.kind === "axis") {
      return typeof payload.target.axisId === "string";
    }

    return payload.target.kind === "new-axis";
  }

  return (
    (payload.command === "zoomToFit" ||
      payload.command === "cancelGesture" ||
      payload.command === "revealSignal") &&
    (payload.args === undefined || isRecord(payload.args))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumericArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSidePanelTraceTuplePayload(value: unknown): value is SidePanelTraceTuplePayload {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !isNonEmptyString(value.traceId) ||
    !isNonEmptyString(value.sourceId) ||
    !isNonEmptyString(value.datasetPath) ||
    !isNonEmptyString(value.xName) ||
    !isNonEmptyString(value.yName) ||
    !isFiniteNumericArray(value.x) ||
    !isFiniteNumericArray(value.y)
  ) {
    return false;
  }

  return value.x.length === value.y.length;
}

function isWorkspaceStateLike(value: unknown): value is WorkspaceStateLike {
  if (!isRecord(value) || typeof value.activePlotId !== "string" || !Array.isArray(value.plots)) {
    return false;
  }

  return value.plots.every((plot) => isPlotStateLike(plot));
}

function isViewerStateLike(value: unknown): value is ViewerStateLike {
  if (!isRecord(value) || !isNonEmptyString(value.activePlotId) || !isRecord(value.activeAxisByPlotId)) {
    return false;
  }

  return Object.values(value.activeAxisByPlotId).every((axisId) => typeof axisId === "string");
}

function isPlotStateLike(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.xSignal !== "string" ||
    typeof value.nextAxisNumber !== "number" ||
    !Number.isInteger(value.nextAxisNumber) ||
    !Array.isArray(value.axes) ||
    !Array.isArray(value.traces)
  ) {
    return false;
  }

  if (value.xRange !== undefined && !isNumericRange(value.xRange)) {
    return false;
  }

  return value.axes.every((axis) => isAxisStateLike(axis)) && value.traces.every((trace) => isTraceStateLike(trace));
}

function isAxisStateLike(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== "string") {
    return false;
  }

  if (value.side !== undefined && value.side !== "left" && value.side !== "right") {
    return false;
  }

  if (value.title !== undefined && typeof value.title !== "string") {
    return false;
  }

  if (value.range !== undefined && !isNumericRange(value.range)) {
    return false;
  }

  if (value.scale !== undefined && value.scale !== "linear" && value.scale !== "log") {
    return false;
  }

  return true;
}

function isTraceStateLike(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.signal !== "string" ||
    (value.sourceId !== undefined && typeof value.sourceId !== "string") ||
    typeof value.axisId !== "string" ||
    typeof value.visible !== "boolean"
  ) {
    return false;
  }

  if (value.color !== undefined && typeof value.color !== "string") {
    return false;
  }

  if (value.lineWidth !== undefined) {
    if (typeof value.lineWidth !== "number" || !Number.isFinite(value.lineWidth)) {
      return false;
    }
  }

  return true;
}

function isNumericRange(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}
