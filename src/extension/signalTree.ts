import type * as VSCode from "vscode";

export const SIGNAL_BROWSER_VIEW_ID = "waveViewer.signalBrowser";
export const SIGNAL_BROWSER_ITEM_CONTEXT = "waveViewer.signal";
export const SIGNAL_BROWSER_DATASET_CONTEXT = "waveViewer.dataset";
export const SIGNAL_BROWSER_GROUP_CONTEXT = "waveViewer.signalGroup";
export const SIGNAL_BROWSER_TREE_DRAG_MIME = "application/vnd.code.tree.waveViewer.signalBrowser";

export const SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND = "waveViewer.signalBrowser.addToPlot";
export const SIGNAL_BROWSER_ADD_TO_NEW_AXIS_COMMAND = "waveViewer.signalBrowser.addToNewAxis";
export const SIGNAL_BROWSER_QUICK_ADD_COMMAND = "waveViewer.signalBrowser.quickAdd";
export const LOAD_CSV_FILES_COMMAND = "waveViewer.signalBrowser.loadCsvFiles";
export const RELOAD_ALL_FILES_COMMAND = "waveViewer.signalBrowser.reloadAllFiles";
export const REMOVE_LOADED_FILE_COMMAND = "waveViewer.signalBrowser.removeLoadedFile";

export type SignalTreeDataset = {
  datasetPath: string;
  fileName: string;
  signals: readonly string[];
};

export type SignalTreeDatasetEntry = SignalTreeDataset & {
  kind: "dataset";
};

export type SignalTreeSignalEntry = {
  kind: "signal";
  signal: string;
  label: string;
  datasetPath: string;
  fileName: string;
};

export type SignalTreeGroupEntry = {
  kind: "group";
  name: string;
  path: readonly string[];
  datasetPath: string;
  fileName: string;
};

export type SignalTreeEntry = SignalTreeDatasetEntry | SignalTreeGroupEntry | SignalTreeSignalEntry;

export type SignalTreeDataProvider = VSCode.TreeDataProvider<SignalTreeEntry> & {
  setLoadedDatasets(datasets: readonly SignalTreeDataset[]): void;
  getLoadedDatasets(): readonly SignalTreeDataset[];
  clear(): void;
};

export function createSignalTreeDragAndDropController(
  vscode: typeof VSCode
): VSCode.TreeDragAndDropController<SignalTreeEntry> {
  return {
    dragMimeTypes: [SIGNAL_BROWSER_TREE_DRAG_MIME, "text/plain"],
    dropMimeTypes: [],
    async handleDrag(source, dataTransfer): Promise<void> {
      const firstEntry = source[0];
      if (!firstEntry || firstEntry.kind !== "signal") {
        return;
      }

      dataTransfer.set(
        SIGNAL_BROWSER_TREE_DRAG_MIME,
        new vscode.DataTransferItem(
          JSON.stringify({ signal: firstEntry.signal, datasetPath: firstEntry.datasetPath })
        )
      );
      dataTransfer.set("text/plain", new vscode.DataTransferItem(firstEntry.signal));
    },
    async handleDrop(): Promise<void> {
      // Side panel is a drag source only for this workflow.
    }
  };
}

export function toDeterministicSignalOrder(signalNames: readonly string[]): string[] {
  return signalNames.slice();
}

export function toDeterministicDatasetOrder(datasets: readonly SignalTreeDataset[]): SignalTreeDataset[] {
  return datasets.slice();
}

export type ResolvedSignalSelection = {
  signal: string;
  datasetPath?: string;
};

export function resolveSignalFromCommandArgument(
  argument: unknown
): ResolvedSignalSelection | undefined {
  if (typeof argument === "string" && argument.trim().length > 0) {
    return { signal: argument.trim() };
  }

  if (!argument || typeof argument !== "object") {
    return undefined;
  }

  const signal = Reflect.get(argument, "signal");
  if (typeof signal !== "string" || signal.trim().length === 0) {
    return undefined;
  }

  const datasetPathCandidate = Reflect.get(argument, "datasetPath");
  const datasetPath =
    typeof datasetPathCandidate === "string" && datasetPathCandidate.trim().length > 0
      ? datasetPathCandidate.trim()
      : undefined;

  return { signal: signal.trim(), datasetPath };
}

export function resolveDatasetPathFromCommandArgument(argument: unknown): string | undefined {
  if (typeof argument === "string" && argument.trim().length > 0) {
    return argument.trim();
  }

  if (!argument || typeof argument !== "object") {
    return undefined;
  }

  const datasetPathCandidate = Reflect.get(argument, "datasetPath");
  if (typeof datasetPathCandidate !== "string" || datasetPathCandidate.trim().length === 0) {
    return undefined;
  }

  return datasetPathCandidate.trim();
}

export function createSignalTreeDataProvider(vscode: typeof VSCode): SignalTreeDataProvider {
  const emitter = new vscode.EventEmitter<SignalTreeEntry | undefined>();
  let loadedDatasets: SignalTreeDataset[] = [];

  return {
    onDidChangeTreeData: emitter.event,
    getTreeItem: (entry) => {
      if (entry.kind === "dataset") {
        return {
          label: entry.fileName,
          description: entry.datasetPath,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          contextValue: SIGNAL_BROWSER_DATASET_CONTEXT,
          tooltip: entry.datasetPath
        } satisfies VSCode.TreeItem;
      }

      if (entry.kind === "group") {
        return {
          label: entry.name,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          contextValue: SIGNAL_BROWSER_GROUP_CONTEXT,
          tooltip: `${entry.path.join("/")}`
        } satisfies VSCode.TreeItem;
      }

      return {
        label: entry.label,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        contextValue: SIGNAL_BROWSER_ITEM_CONTEXT,
        tooltip: `${entry.signal} (${entry.fileName})\nDouble-click to quick add to active/default lane`,
        command: {
          command: SIGNAL_BROWSER_QUICK_ADD_COMMAND,
          title: "Quick Add",
          arguments: [entry]
        }
      } satisfies VSCode.TreeItem;
    },
    getChildren: (entry) => {
      if (!entry) {
        return loadedDatasets.map((dataset) => ({
          kind: "dataset" as const,
          datasetPath: dataset.datasetPath,
          fileName: dataset.fileName,
          signals: dataset.signals
        }));
      }

      if (entry.kind !== "dataset") {
        if (entry.kind === "group") {
          return buildSignalTreeChildren(entry, loadedDatasets);
        }
        return [];
      }

      return buildSignalTreeChildren(entry, loadedDatasets);
    },
    setLoadedDatasets: (datasets) => {
      const nextDatasets = toDeterministicDatasetOrder(datasets).map((dataset) => ({
        datasetPath: dataset.datasetPath,
        fileName: dataset.fileName,
        signals: toDeterministicSignalOrder(dataset.signals)
      }));
      const changed =
        nextDatasets.length !== loadedDatasets.length ||
        nextDatasets.some((dataset, index) => {
          const previous = loadedDatasets[index];
          if (!previous) {
            return true;
          }
          if (
            dataset.datasetPath !== previous.datasetPath ||
            dataset.fileName !== previous.fileName ||
            dataset.signals.length !== previous.signals.length
          ) {
            return true;
          }
          return dataset.signals.some((signal, signalIndex) => signal !== previous.signals[signalIndex]);
        });
      if (!changed) {
        return;
      }
      loadedDatasets = nextDatasets;
      emitter.fire(undefined);
    },
    getLoadedDatasets: () => loadedDatasets.slice(),
    clear: () => {
      if (loadedDatasets.length === 0) {
        return;
      }
      loadedDatasets = [];
      emitter.fire(undefined);
    }
  };
}

function buildSignalTreeChildren(
  entry: SignalTreeDatasetEntry | SignalTreeGroupEntry,
  loadedDatasets: readonly SignalTreeDataset[]
): SignalTreeEntry[] {
  const dataset = loadedDatasets.find((candidate) => candidate.datasetPath === entry.datasetPath);
  if (!dataset) {
    return [];
  }

  const signalPaths = toDeterministicSignalOrder(dataset.signals).map((signal) => ({
    signal,
    path: toSignalPath(signal)
  }));

  const currentPath = entry.kind === "group" ? entry.path : [];
  const groups: SignalTreeGroupEntry[] = [];
  const groupSeen = new Set<string>();
  const signals: SignalTreeSignalEntry[] = [];

  for (const item of signalPaths) {
    if (item.path.length <= currentPath.length) {
      continue;
    }
    if (!startsWithPath(item.path, currentPath)) {
      continue;
    }
    const nextSegment = item.path[currentPath.length];
    if (item.path.length === currentPath.length + 1) {
      signals.push({
        kind: "signal",
        signal: item.signal,
        label: nextSegment,
        datasetPath: dataset.datasetPath,
        fileName: dataset.fileName
      });
      continue;
    }
    if (!groupSeen.has(nextSegment)) {
      groupSeen.add(nextSegment);
      groups.push({
        kind: "group",
        name: nextSegment,
        path: [...currentPath, nextSegment],
        datasetPath: dataset.datasetPath,
        fileName: dataset.fileName
      });
    }
  }

  return [...groups, ...signals];
}

function startsWithPath(path: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length > path.length) {
    return false;
  }
  for (let index = 0; index < prefix.length; index += 1) {
    if (path[index] !== prefix[index]) {
      return false;
    }
  }
  return true;
}

function toSignalPath(signal: string): string[] {
  const trimmedSignal = signal.trim();
  if (trimmedSignal.length === 0) {
    return [signal];
  }

  if (trimmedSignal.includes("/")) {
    const pathSegments = trimmedSignal
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    if (pathSegments.length > 0) {
      return pathSegments;
    }
  }

  return [trimmedSignal];
}

export function createDoubleClickQuickAddResolver(options?: {
  thresholdMs?: number;
  now?: () => number;
}): (selection: ResolvedSignalSelection) => boolean {
  const thresholdMs = options?.thresholdMs ?? 450;
  const now = options?.now ?? (() => Date.now());

  let lastSelectionKey: string | undefined;
  let lastClickTimestamp = 0;

  return (selection: ResolvedSignalSelection): boolean => {
    const timestamp = now();
    const selectionKey = selection.datasetPath
      ? `${selection.datasetPath}\u0000${selection.signal}`
      : `\u0000${selection.signal}`;
    const isDoubleClick =
      lastSelectionKey === selectionKey &&
      timestamp - lastClickTimestamp >= 0 &&
      timestamp - lastClickTimestamp <= thresholdMs;

    lastSelectionKey = selectionKey;
    lastClickTimestamp = timestamp;

    if (!isDoubleClick) {
      return false;
    }

    // Require a fresh pair of clicks for the next quick-add.
    lastSelectionKey = undefined;
    return true;
  };
}
