import type { AxisId, AxisState, TraceState } from "../state/workspaceState";
import { formatAxisOptionLabel } from "./axisLabels";

export type SignalListProps = {
  container: HTMLElement;
  signals: string[];
  axes: AxisState[];
  traces: TraceState[];
  onAddTrace(payload: { signal: string; axisChoice: AxisId | "create-new" }): void;
  onQuickAdd?(payload: { signal: string }): void;
};

export type SignalPanelModel = {
  availableSignals: string[];
  lanes: Array<{
    axisId: AxisId;
    axisLabel: string;
    assignedSignals: string[];
  }>;
};

export function buildSignalPanelModel(payload: {
  signals: string[];
  axes: AxisState[];
  traces: TraceState[];
}): SignalPanelModel {
  const signalsByAxis = new Map<AxisId, string[]>();
  for (const axis of payload.axes) {
    signalsByAxis.set(axis.id, []);
  }

  for (const trace of payload.traces) {
    const assignedSignals = signalsByAxis.get(trace.axisId);
    if (!assignedSignals) {
      continue;
    }
    assignedSignals.push(trace.signal);
  }

  return {
    availableSignals: payload.signals.slice(),
    lanes: payload.axes.map((axis) => ({
      axisId: axis.id,
      axisLabel: formatAxisOptionLabel(payload.axes, axis.id),
      assignedSignals: signalsByAxis.get(axis.id) ?? []
    }))
  };
}

export function renderSignalList(props: SignalListProps): void {
  props.container.replaceChildren();
  const model = buildSignalPanelModel({
    signals: props.signals,
    axes: props.axes,
    traces: props.traces
  });

  const availableSection = createSection("Available Signals");
  props.container.appendChild(availableSection.section);

  if (model.availableSignals.length === 0) {
    availableSection.body.appendChild(createMutedText("No plottable signals available."));
  } else {
    for (const signal of model.availableSignals) {
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
      availableSection.body.appendChild(row);
    }
  }

  for (const lane of model.lanes) {
    const laneSection = createSection(`Assigned to ${lane.axisLabel}`);
    if (lane.assignedSignals.length === 0) {
      laneSection.body.appendChild(createMutedText("No signals assigned to this lane."));
    } else {
      for (const signal of lane.assignedSignals) {
        const row = document.createElement("div");
        row.className = "list-row signal-assigned-row";
        const name = document.createElement("span");
        name.className = "signal-name";
        name.textContent = signal;
        row.appendChild(name);
        laneSection.body.appendChild(row);
      }
    }
    props.container.appendChild(laneSection.section);
  }
}

function createMutedText(text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.className = "muted";
  paragraph.textContent = text;
  return paragraph;
}

function createSection(titleText: string): { section: HTMLElement; body: HTMLElement } {
  const section = document.createElement("section");
  section.className = "signal-panel-section";

  const title = document.createElement("h3");
  title.className = "signal-panel-section-title";
  title.textContent = titleText;

  const body = document.createElement("div");
  body.className = "list-stack";

  section.append(title, body);
  return { section, body };
}
