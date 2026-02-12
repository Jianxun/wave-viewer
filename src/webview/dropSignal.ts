export const SIGNAL_TREE_DRAG_MIME = "application/vnd.code.tree.waveViewer.signalBrowser";

type DropDataTransferTypesLike = {
  readonly types: readonly string[];
};

type DropDataTransferLike = {
  readonly types: readonly string[];
  getData(type: string): string;
};

export function hasSupportedDropSignalType(dataTransfer: DropDataTransferLike): boolean {
  const availableTypes = new Set(dataTransfer.types);
  if (availableTypes.size === 0) {
    // VS Code drag sources can report an empty types list during hover.
    return true;
  }
  if (availableTypes.has(SIGNAL_TREE_DRAG_MIME) || availableTypes.has("text/plain")) {
    return true;
  }

  // Some environments expose payload data while reporting incomplete `types`.
  return (
    extractSignalForType(dataTransfer, "text/plain") !== undefined ||
    extractSignalForType(dataTransfer, SIGNAL_TREE_DRAG_MIME) !== undefined
  );
}

export function extractSignalFromDropData(dataTransfer: DropDataTransferLike): string | undefined {
  const preferredTypes = [SIGNAL_TREE_DRAG_MIME, "text/plain"];
  const availableTypes = new Set(dataTransfer.types);

  for (const type of preferredTypes) {
    if (!availableTypes.has(type)) {
      continue;
    }

    const signal = extractSignalForType(dataTransfer, type);
    if (signal) {
      return signal;
    }
  }

  // Fallback for cases where `types` is missing/partial but payload is still readable.
  for (const type of preferredTypes) {
    if (availableTypes.has(type)) {
      continue;
    }
    const signal = extractSignalForType(dataTransfer, type);
    if (signal) {
      return signal;
    }
  }

  return undefined;
}

function extractSignalForType(dataTransfer: DropDataTransferLike, type: string): string | undefined {
  const value = safeGetData(dataTransfer, type);
  if (value === undefined) {
    return undefined;
  }
  return type === SIGNAL_TREE_DRAG_MIME ? parseSignalTreeDragPayload(value) : normalizeSignal(value);
}

function safeGetData(dataTransfer: DropDataTransferLike, type: string): string | undefined {
  try {
    return dataTransfer.getData(type);
  } catch {
    return undefined;
  }
}

function parseSignalTreeDragPayload(rawPayload: string): string | undefined {
  const normalized = normalizeSignal(rawPayload);
  if (!normalized) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    return parseSignalPayload(parsed);
  } catch {
    // Non-JSON tree payloads can still be plain signal names.
  }

  return normalizeSignal(normalized);
}

function parseSignalPayload(value: unknown): string | undefined {
  if (typeof value === "string") {
    return normalizeSignal(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const signal = parseSignalPayload(entry);
      if (signal) {
        return signal;
      }
    }
    return undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const signal = Reflect.get(value, "signal");
  return typeof signal === "string" ? normalizeSignal(signal) : undefined;
}

function normalizeSignal(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
