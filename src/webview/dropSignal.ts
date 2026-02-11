export const SIGNAL_TREE_DRAG_MIME = "application/vnd.code.tree.waveViewer.signalBrowser";

type DropDataTransferLike = {
  readonly types: readonly string[];
  getData(type: string): string;
};

export function extractSignalFromDropData(dataTransfer: DropDataTransferLike): string | undefined {
  const preferredTypes = [SIGNAL_TREE_DRAG_MIME, "text/plain"];
  const availableTypes = new Set(dataTransfer.types);

  for (const type of preferredTypes) {
    if (!availableTypes.has(type)) {
      continue;
    }

    const value = dataTransfer.getData(type);
    const signal =
      type === SIGNAL_TREE_DRAG_MIME ? parseSignalTreeDragPayload(value) : normalizeSignal(value);
    if (signal) {
      return signal;
    }
  }

  return undefined;
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
