import type * as VSCode from "vscode";

export const SIGNAL_BROWSER_VIEW_ID = "waveViewer.signalBrowser";
export const SIGNAL_BROWSER_ITEM_CONTEXT = "waveViewer.signal";

export const SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND = "waveViewer.signalBrowser.addToPlot";
export const SIGNAL_BROWSER_ADD_TO_NEW_AXIS_COMMAND = "waveViewer.signalBrowser.addToNewAxis";
export const REVEAL_SIGNAL_IN_PLOT_COMMAND = "waveViewer.signalBrowser.revealInPlot";

export type SignalTreeEntry = {
  signal: string;
};

export type SignalTreeDataProvider = VSCode.TreeDataProvider<SignalTreeEntry> & {
  setSignals(signalNames: readonly string[]): void;
  getSignals(): readonly string[];
  clear(): void;
};

export function toDeterministicSignalOrder(signalNames: readonly string[]): string[] {
  return signalNames.slice();
}

export function resolveSignalFromCommandArgument(argument: unknown): string | undefined {
  if (typeof argument === "string" && argument.trim().length > 0) {
    return argument.trim();
  }

  if (!argument || typeof argument !== "object") {
    return undefined;
  }

  const signal = Reflect.get(argument, "signal");
  if (typeof signal !== "string" || signal.trim().length === 0) {
    return undefined;
  }

  return signal.trim();
}

export function createSignalTreeDataProvider(vscode: typeof VSCode): SignalTreeDataProvider {
  const emitter = new vscode.EventEmitter<SignalTreeEntry | undefined>();
  let signals: string[] = [];

  return {
    onDidChangeTreeData: emitter.event,
    getTreeItem: (entry) =>
      ({
        label: entry.signal,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        contextValue: SIGNAL_BROWSER_ITEM_CONTEXT,
        command: {
          command: SIGNAL_BROWSER_ADD_TO_PLOT_COMMAND,
          title: "Add to Plot",
          arguments: [entry]
        }
      }) satisfies VSCode.TreeItem,
    getChildren: () => signals.map((signal) => ({ signal })),
    setSignals: (signalNames) => {
      const nextSignals = toDeterministicSignalOrder(signalNames);
      const changed =
        nextSignals.length !== signals.length ||
        nextSignals.some((signal, index) => signal !== signals[index]);
      if (!changed) {
        return;
      }
      signals = nextSignals;
      emitter.fire(undefined);
    },
    getSignals: () => signals.slice(),
    clear: () => {
      if (signals.length === 0) {
        return;
      }
      signals = [];
      emitter.fire(undefined);
    }
  };
}
