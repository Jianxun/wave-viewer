import type { AxisId, AxisState, TraceState } from "../state/workspaceState";
import { formatAxisOptionLabel } from "./axisLabels";

export type SignalListProps = {
  container: HTMLElement;
  axes: AxisState[];
  traces: TraceState[];
  onSetAxis(traceId: string, axisId: AxisId): void;
  onSetVisible(traceId: string, visible: boolean): void;
  onRemove(traceId: string): void;
};

export type SignalPanelModel = {
  lanes: Array<{
    axisId: AxisId;
    axisLabel: string;
    traceChips: TraceState[];
  }>;
};

export function buildSignalPanelModel(payload: {
  axes: AxisState[];
  traces: TraceState[];
}): SignalPanelModel {
  const tracesByAxis = new Map<AxisId, TraceState[]>();
  for (const axis of payload.axes) {
    tracesByAxis.set(axis.id, []);
  }

  for (const trace of payload.traces) {
    const assignedTraces = tracesByAxis.get(trace.axisId);
    if (!assignedTraces) {
      continue;
    }
    assignedTraces.push(trace);
  }

  return {
    lanes: payload.axes.map((axis) => ({
      axisId: axis.id,
      axisLabel: formatAxisOptionLabel(payload.axes, axis.id),
      traceChips: tracesByAxis.get(axis.id) ?? []
    }))
  };
}

export function resolveTraceLaneReassignment(payload: {
  traces: TraceState[];
  traceId: string;
  targetAxisId: AxisId;
}): { traceId: string; axisId: AxisId } | undefined {
  const trace = payload.traces.find((entry) => entry.id === payload.traceId);
  if (!trace) {
    return undefined;
  }
  if (trace.axisId === payload.targetAxisId) {
    return undefined;
  }
  return {
    traceId: trace.id,
    axisId: payload.targetAxisId
  };
}

export function renderSignalList(props: SignalListProps): void {
  props.container.replaceChildren();
  const model = buildSignalPanelModel({
    axes: props.axes,
    traces: props.traces
  });

  for (const lane of model.lanes) {
    const laneSection = createSection(lane.axisLabel);
    laneSection.body.classList.add("trace-lane-body", "drop-target");
    laneSection.body.dataset.axisId = lane.axisId;

    laneSection.body.addEventListener("dragover", (event) => {
      if (!event.dataTransfer) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      laneSection.body.classList.add("drop-active");
    });

    laneSection.body.addEventListener("dragleave", (event) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (nextTarget && laneSection.body.contains(nextTarget)) {
        return;
      }
      laneSection.body.classList.remove("drop-active");
    });

    laneSection.body.addEventListener("drop", (event) => {
      laneSection.body.classList.remove("drop-active");
      if (!event.dataTransfer) {
        return;
      }

      const traceId = event.dataTransfer.getData("text/wave-viewer-trace-id");
      const reassignment = resolveTraceLaneReassignment({
        traces: props.traces,
        traceId,
        targetAxisId: lane.axisId
      });
      if (!reassignment) {
        return;
      }

      event.preventDefault();
      props.onSetAxis(reassignment.traceId, reassignment.axisId);
    });

    if (lane.traceChips.length === 0) {
      laneSection.body.appendChild(createMutedText("No traces assigned."));
    } else {
      for (const trace of lane.traceChips) {
        const chip = document.createElement("div");
        chip.className = "list-row trace-chip-row";
        chip.draggable = true;
        chip.dataset.traceId = trace.id;
        chip.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("text/wave-viewer-trace-id", trace.id);
          event.dataTransfer?.setData("text/plain", trace.id);
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
          }
          chip.classList.add("trace-chip-dragging");
        });
        chip.addEventListener("dragend", () => {
          chip.classList.remove("trace-chip-dragging");
          laneSection.body.classList.remove("drop-active");
        });

        const name = document.createElement("span");
        name.className = "signal-name";
        name.textContent = trace.signal;

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
        removeButton.textContent = "Remove";
        removeButton.addEventListener("click", () => props.onRemove(trace.id));

        chip.append(name, visibleToggle, removeButton);
        laneSection.body.appendChild(chip);
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
  title.textContent = `Lane ${titleText}`;

  const body = document.createElement("div");
  body.className = "list-stack";

  section.append(title, body);
  return { section, body };
}
