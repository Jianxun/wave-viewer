import type { AxisId, AxisState, TraceState } from "../state/workspaceState";
import { formatAxisOptionLabel } from "./axisLabels";

export type TraceListProps = {
  container: HTMLElement;
  traces: TraceState[];
  axes: AxisState[];
  onSetAxis(traceId: string, axisId: AxisId): void;
  onSetVisible(traceId: string, visible: boolean): void;
  onRemove(traceId: string): void;
};

export function renderTraceList(props: TraceListProps): void {
  props.container.replaceChildren();

  if (props.traces.length === 0) {
    props.container.appendChild(createMutedText("No traces yet."));
    return;
  }

  for (const trace of props.traces) {
    const row = document.createElement("div");
    row.className = "list-row";

    const label = document.createElement("span");
    label.className = "signal-name";
    label.textContent = trace.signal;

    const axisSelect = document.createElement("select");
    axisSelect.className = "inline-select";
    for (const axis of props.axes) {
      axisSelect.add(
        new Option(
          formatAxisOptionLabel(props.axes, axis.id),
          axis.id,
          axis.id === trace.axisId
        )
      );
    }
    axisSelect.addEventListener("change", () => props.onSetAxis(trace.id, axisSelect.value as AxisId));

    const visibleToggle = document.createElement("label");
    visibleToggle.className = "inline-toggle";
    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.checked = trace.visible;
    toggleInput.addEventListener("change", () => props.onSetVisible(trace.id, toggleInput.checked));
    const toggleText = document.createElement("span");
    toggleText.textContent = "Visible";
    visibleToggle.append(toggleInput, toggleText);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "chip-button";
    removeButton.textContent = "Delete";
    removeButton.addEventListener("click", () => props.onRemove(trace.id));

    row.append(label, axisSelect, visibleToggle, removeButton);
    props.container.appendChild(row);
  }
}

function createMutedText(text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.className = "muted";
  paragraph.textContent = text;
  return paragraph;
}
