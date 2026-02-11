import type { AxisId, AxisState } from "../state/workspaceState";
import { formatAxisOptionLabel } from "./axisLabels";

export type SignalListProps = {
  container: HTMLElement;
  signals: string[];
  axes: AxisState[];
  onAddTrace(payload: { signal: string; axisChoice: AxisId | "create-new" }): void;
  onQuickAdd?(payload: { signal: string }): void;
};

export function renderSignalList(props: SignalListProps): void {
  props.container.replaceChildren();

  if (props.signals.length === 0) {
    props.container.appendChild(createMutedText("No plottable signals available."));
    return;
  }

  for (const signal of props.signals) {
    const row = document.createElement("div");
    row.className = "list-row";

    const name = document.createElement("span");
    name.className = "signal-name";
    name.textContent = signal;
    name.title = "Double-click to quick add to active/default lane";
    name.addEventListener("dblclick", () => {
      props.onQuickAdd?.({ signal });
    });

    const axisSelect = document.createElement("select");
    axisSelect.className = "inline-select";
    for (const axis of props.axes) {
      axisSelect.add(new Option(formatAxisOptionLabel(props.axes, axis.id), axis.id));
    }
    axisSelect.add(new Option("Create new axis", "create-new"));

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "chip-button";
    addButton.textContent = "+ Trace";
    addButton.addEventListener("click", () => {
      props.onAddTrace({ signal, axisChoice: axisSelect.value as AxisId | "create-new" });
    });

    row.append(name, axisSelect, addButton);
    props.container.appendChild(row);
  }
}

function createMutedText(text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.className = "muted";
  paragraph.textContent = text;
  return paragraph;
}
