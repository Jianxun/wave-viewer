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

export const PROTOCOL_VERSION = 1 as const;

export type ProtocolEnvelope<TType extends string, TPayload> = {
  version: typeof PROTOCOL_VERSION;
  type: TType;
  payload: TPayload;
};

export type HostToWebviewMessageType =
  | "host/init"
  | "host/datasetLoaded"
  | "host/workspaceLoaded"
  | "host/workspacePatched"
  | "host/sidePanelQuickAdd";

export type WebviewToHostMessageType =
  | "webview/ready"
  | "webview/workspaceChanged"
  | "webview/dropSignal"
  | "webview/command";

export type ParsedHostToWebviewMessage =
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
  | ProtocolEnvelope<"host/workspaceLoaded", { workspace: WorkspaceStateLike }>
  | ProtocolEnvelope<"host/workspacePatched", { workspace: WorkspaceStateLike; reason: string }>
  | ProtocolEnvelope<"host/sidePanelQuickAdd", { signal: string }>;

export type ParsedWebviewToHostMessage =
  | ProtocolEnvelope<"webview/ready", Record<string, unknown>>
  | ProtocolEnvelope<
      "webview/workspaceChanged",
      { workspace: WorkspaceStateLike; reason: string }
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
      axisId: `y${number}` | string;
      visible: boolean;
      color?: string;
      lineWidth?: number;
    }>;
    nextAxisNumber: number;
    xRange?: [number, number];
  }>;
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
    type === "host/datasetLoaded" ||
    type === "host/workspaceLoaded" ||
    type === "host/workspacePatched" ||
    type === "host/sidePanelQuickAdd"
  );
}

function isWebviewMessageType(type: string): type is WebviewToHostMessageType {
  return (
    type === "webview/ready" ||
    type === "webview/workspaceChanged" ||
    type === "webview/dropSignal" ||
    type === "webview/command"
  );
}

function isValidHostPayload(type: HostToWebviewMessageType, payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  if (type === "host/init") {
    return typeof payload.title === "string";
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

  if (type === "host/workspacePatched") {
    return isWorkspaceStateLike(payload.workspace) && typeof payload.reason === "string";
  }

  if (type === "host/sidePanelQuickAdd") {
    return typeof payload.signal === "string" && payload.signal.trim().length > 0;
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

  if (type === "webview/workspaceChanged") {
    return isWorkspaceStateLike(payload.workspace) && typeof payload.reason === "string";
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

function isWorkspaceStateLike(value: unknown): value is WorkspaceStateLike {
  if (!isRecord(value) || typeof value.activePlotId !== "string" || !Array.isArray(value.plots)) {
    return false;
  }

  return value.plots.every((plot) => isPlotStateLike(plot));
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
