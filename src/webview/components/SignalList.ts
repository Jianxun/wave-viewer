import type { AxisId, AxisState, TraceState } from "../state/workspaceState";
import { formatAxisOptionLabel } from "./axisLabels";

type DropSignalTarget = { kind: "axis"; axisId: AxisId } | { kind: "new-axis"; afterAxisId?: AxisId };

export type SignalListProps = {
  container: HTMLElement;
  axes: AxisState[];
  traces: TraceState[];
  activeAxisId?: AxisId;
  canDropSignal(event: DragEvent): boolean;
  parseDroppedSignal(event: DragEvent): string | undefined;
  onDropSignal(payload: { signal: string; target: DropSignalTarget }): void;
  onDropTraceToNewLane(payload: { traceId: string; afterAxisId: AxisId }): void;
  onCreateLane(afterAxisId?: AxisId): void;
  onReorderLane(payload: { axisId: AxisId; toIndex: number }): void;
  onRemoveLane(payload: { axisId: AxisId; traceIds: string[] }): void;
  onSetAxis(traceId: string, axisId: AxisId): void;
  onActivateLane(axisId: AxisId): void;
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
  for (const [laneIndex, lane] of model.lanes.entries()) {
    const laneSection = createSection(lane.axisLabel);
    laneSection.section.classList.toggle("axis-row-active", lane.axisId === props.activeAxisId);
    laneSection.body.classList.add("trace-lane-body", "drop-target");
    laneSection.body.dataset.axisId = lane.axisId;
    laneSection.section.addEventListener("click", (event) => {
      if (shouldIgnoreLaneActivation(event.target)) {
        return;
      }
      props.onActivateLane(lane.axisId);
    });

    const moveUpButton = document.createElement("button");
    moveUpButton.type = "button";
    moveUpButton.className = "chip-button lane-action-button";
    moveUpButton.textContent = "Up";
    moveUpButton.title = "Move lane up";
    moveUpButton.disabled = laneIndex === 0;
    moveUpButton.addEventListener("click", () => {
      props.onReorderLane({
        axisId: lane.axisId,
        toIndex: laneIndex - 1
      });
    });

    const moveDownButton = document.createElement("button");
    moveDownButton.type = "button";
    moveDownButton.className = "chip-button lane-action-button";
    moveDownButton.textContent = "Down";
    moveDownButton.title = "Move lane down";
    moveDownButton.disabled = laneIndex >= model.lanes.length - 1;
    moveDownButton.addEventListener("click", () => {
      props.onReorderLane({
        axisId: lane.axisId,
        toIndex: laneIndex + 1
      });
    });

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "chip-button lane-action-button";
    closeButton.textContent = "Close";
    closeButton.title = "Remove lane and all traces assigned to it";
    closeButton.disabled = model.lanes.length <= 1;
    closeButton.addEventListener("click", () => {
      props.onRemoveLane({
        axisId: lane.axisId,
        traceIds: lane.traceChips.map((trace) => trace.id)
      });
    });
    laneSection.actions.append(moveUpButton, moveDownButton, closeButton);

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

  const lastLaneAxisId = model.lanes[model.lanes.length - 1]?.axisId;
  props.container.appendChild(
    createDropToNewLaneSection({
      traces: props.traces,
      afterAxisId: lastLaneAxisId,
      canDropSignal: props.canDropSignal,
      parseDroppedSignal: props.parseDroppedSignal,
      onDropTraceToNewLane: (traceId, afterAxisId) =>
        props.onDropTraceToNewLane({ traceId, afterAxisId }),
      onCreateLane: (afterAxisId) => props.onCreateLane(afterAxisId),
      onDropSignal: (signal) =>
        props.onDropSignal({
          signal,
          target: { kind: "new-axis", afterAxisId: lastLaneAxisId }
        })
    })
  );

  if (props.traces.length === 0) {
    props.container.prepend(createMutedText("No traces yet. Add signals from the Explorer side panel."));
  }
}

function shouldIgnoreLaneActivation(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return target.closest("button,input,label,select,textarea,a") !== null;
}

function createMutedText(text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.className = "muted";
  paragraph.textContent = text;
  return paragraph;
}

function createSection(titleText: string): { section: HTMLElement; body: HTMLElement; actions: HTMLElement } {
  const section = document.createElement("section");
  section.className = "signal-panel-section";

  const header = document.createElement("div");
  header.className = "signal-panel-section-header";

  const title = document.createElement("h3");
  title.className = "signal-panel-section-title";
  title.textContent = `Lane ${titleText}`;

  const actions = document.createElement("div");
  actions.className = "signal-panel-actions";
  header.append(title, actions);

  const body = document.createElement("div");
  body.className = "list-stack";

  section.append(header, body);
  return { section, body, actions };
}

function createDropToNewLaneSection(options: {
  traces: TraceState[];
  afterAxisId?: AxisId;
  onCreateLane(afterAxisId?: AxisId): void;
  canDropSignal(event: DragEvent): boolean;
  parseDroppedSignal(event: DragEvent): string | undefined;
  onDropTraceToNewLane(traceId: string, afterAxisId: AxisId): void;
  onDropSignal(signal: string): void;
}): HTMLElement {
  const section = document.createElement("section");
  section.className = "signal-panel-section";

  const body = document.createElement("button");
  body.type = "button";
  body.className = "list-row axis-row-new-target drop-target chip-button";
  body.textContent = "Click here to create a new lane";
  body.addEventListener("click", () => {
    options.onCreateLane(options.afterAxisId);
  });
  body.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer) {
      return;
    }
    event.preventDefault();
    body.classList.add("drop-active");
  });
  body.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = hasTraceChipDrop(event.dataTransfer) ? "move" : "copy";
    body.classList.add("drop-active");
  });
  body.addEventListener("dragleave", (event) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && body.contains(nextTarget)) {
      return;
    }
    body.classList.remove("drop-active");
  });
  body.addEventListener("drop", (event) => {
    body.classList.remove("drop-active");
    if (!event.dataTransfer) {
      return;
    }

    const traceId = event.dataTransfer.getData("text/wave-viewer-trace-id");
    if (!options.afterAxisId) {
      return;
    }
    const trace = options.traces.find((entry) => entry.id === traceId);
    if (trace) {
      event.preventDefault();
      event.stopImmediatePropagation();
      options.onDropTraceToNewLane(trace.id, options.afterAxisId);
      return;
    }
  });
  addDropHandlers({
    target: body,
    canDropSignal: options.canDropSignal,
    parseDroppedSignal: options.parseDroppedSignal,
    onDropSignal: options.onDropSignal
  });

  section.append(body);
  return section;
}

function hasTraceChipDrop(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes("text/wave-viewer-trace-id");
}

function addDropHandlers(options: {
  target: HTMLElement;
  canDropSignal(event: DragEvent): boolean;
  parseDroppedSignal(event: DragEvent): string | undefined;
  onDropSignal(signal: string): void;
}): void {
  const setActive = (active: boolean) => {
    options.target.classList.toggle("drop-active", active);
  };

  options.target.addEventListener("dragenter", (event) => {
    if (!options.canDropSignal(event)) {
      return;
    }
    event.preventDefault();
    setActive(true);
  });

  options.target.addEventListener("dragover", (event) => {
    if (!options.canDropSignal(event)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    setActive(true);
  });

  options.target.addEventListener("dragleave", () => {
    setActive(false);
  });

  options.target.addEventListener("drop", (event) => {
    const signal = options.parseDroppedSignal(event);
    setActive(false);
    if (!signal) {
      if (event.dataTransfer) {
        console.debug("[wave-viewer] Ignored drop on new-lane target: no signal payload resolved.", {
          types: Array.from(event.dataTransfer.types)
        });
      }
      return;
    }
    event.preventDefault();
    options.onDropSignal(signal);
  });
}
