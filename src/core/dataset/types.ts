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
  | "host/workspacePatched";

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
  | ProtocolEnvelope<"host/workspaceLoaded", { workspace: Record<string, unknown> }>
  | ProtocolEnvelope<"host/workspacePatched", { workspace: Record<string, unknown>; reason: string }>;

export type ParsedWebviewToHostMessage =
  | ProtocolEnvelope<"webview/ready", Record<string, unknown>>
  | ProtocolEnvelope<"webview/workspaceChanged", { workspace: Record<string, unknown> }>
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
    type === "host/workspacePatched"
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
    return isRecord(payload.workspace) && typeof payload.reason === "string";
  }

  return isRecord(payload.workspace);
}

function isValidWebviewPayload(type: WebviewToHostMessageType, payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  if (type === "webview/ready") {
    return true;
  }

  if (type === "webview/workspaceChanged") {
    return isRecord(payload.workspace);
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
