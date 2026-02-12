import type { AxisId, AxisState, TraceState } from "../state/workspaceState";
import { formatAxisOptionLabel } from "./axisLabels";

export type SignalListProps = {
  container: HTMLElement;
  axes: AxisState[];
  traces: TraceState[];
};

export type SignalPanelModel = {
  lanes: Array<{
    axisId: AxisId;
    axisLabel: string;
    assignedSignals: string[];
  }>;
};

export function buildSignalPanelModel(payload: {
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
    axes: props.axes,
    traces: props.traces
  });

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

  if (props.traces.length === 0) {
    props.container.prepend(createMutedText("No traces yet. Add signals from the Explorer side panel."));
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
