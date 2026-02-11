import { describe, expect, it } from "vitest";

import {
  SIGNAL_BROWSER_QUICK_ADD_COMMAND,
  createDoubleClickQuickAddResolver,
  createSignalTreeDataProvider,
  resolveSignalFromCommandArgument
} from "../../../src/extension/signalTree";

describe("signal tree quick-add", () => {
  it("requires a second click on the same signal within threshold", () => {
    let now = 1_000;
    const resolve = createDoubleClickQuickAddResolver({
      thresholdMs: 500,
      now: () => now
    });

    expect(resolve("vin")).toBe(false);
    now += 300;
    expect(resolve("vin")).toBe(true);
  });

  it("does not trigger when clicks exceed threshold or signal changes", () => {
    let now = 1_000;
    const resolve = createDoubleClickQuickAddResolver({
      thresholdMs: 200,
      now: () => now
    });

    expect(resolve("vin")).toBe(false);
    now += 300;
    expect(resolve("vin")).toBe(false);
    now += 10;
    expect(resolve("vout")).toBe(false);
    now += 10;
    expect(resolve("vin")).toBe(false);
  });

  it("uses stable quick-add command id", () => {
    expect(SIGNAL_BROWSER_QUICK_ADD_COMMAND).toBe("waveViewer.signalBrowser.quickAdd");
  });
});

describe("signal tree dataset registry entries", () => {
  function createVscodeShim() {
    class EventEmitter<T> {
      private listeners: Array<(value: T) => void> = [];

      public readonly event = (listener: (value: T) => void) => {
        this.listeners.push(listener);
        return { dispose: () => undefined };
      };

      public fire(value: T): void {
        for (const listener of this.listeners) {
          listener(value);
        }
      }
    }

    return {
      EventEmitter,
      TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1
      }
    };
  }

  it("renders loaded files as parent entries and signals as children", async () => {
    const provider = createSignalTreeDataProvider(createVscodeShim() as never);

    provider.setLoadedDatasets([
      {
        datasetPath: "/workspace/examples/a.csv",
        fileName: "a.csv",
        signals: ["time", "vin"]
      }
    ]);

    const roots = (await provider.getChildren()) ?? [];
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({
      kind: "dataset",
      datasetPath: "/workspace/examples/a.csv",
      fileName: "a.csv"
    });

    const children = (await provider.getChildren(roots[0])) ?? [];
    expect(children).toEqual([
      {
        kind: "signal",
        signal: "time",
        datasetPath: "/workspace/examples/a.csv",
        fileName: "a.csv"
      },
      {
        kind: "signal",
        signal: "vin",
        datasetPath: "/workspace/examples/a.csv",
        fileName: "a.csv"
      }
    ]);
  });

  it("resolves signal + datasetPath from tree item command args", () => {
    expect(
      resolveSignalFromCommandArgument({
        kind: "signal",
        signal: "vin",
        datasetPath: "/workspace/examples/a.csv"
      })
    ).toEqual({
      signal: "vin",
      datasetPath: "/workspace/examples/a.csv"
    });
  });
});
