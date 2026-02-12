import type { AxisId, AxisState } from "../state/workspaceState";
import { formatAxisLaneLabel, formatAxisOptionLabel } from "./axisLabels";

export type AxisManagerProps = {
  container: HTMLElement;
  axes: AxisState[];
  activeAxisId?: AxisId;
  onAddAxis(): void;
  canDropSignal(event: DragEvent): boolean;
  parseDroppedSignal(event: DragEvent): string | undefined;
  onDropSignal(payload: { signal: string; target: { kind: "axis"; axisId: AxisId } }): void;
  onReorderAxis(payload: { axisId: AxisId; toIndex: number }): void;
  onRemoveAxis(payload: { axisId: AxisId; reassignToAxisId?: AxisId }): void;
  onReassignTraces(payload: { fromAxisId: AxisId; toAxisId: AxisId }): void;
  onUpdateAxis(payload: { axisId: AxisId; patch: Partial<Omit<AxisState, "id">> }): void;
};

export function renderAxisManager(props: AxisManagerProps): void {
  props.container.replaceChildren();

  for (const [index, axis] of props.axes.entries()) {
    const row = document.createElement("div");
    row.className = "list-row axis-row drop-target";
    row.setAttribute("aria-label", `Drop signal on axis ${axis.id}`);
    row.classList.toggle("axis-row-active", axis.id === props.activeAxisId);

    const label = document.createElement("span");
    label.className = "signal-name";
    label.textContent = formatAxisLaneLabel(props.axes, axis);

    if (axis.id === props.activeAxisId) {
      const activeBadge = document.createElement("span");
      activeBadge.className = "axis-active-chip";
      activeBadge.textContent = "Active";
      row.append(label, activeBadge);
    } else {
      row.append(label);
    }

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "inline-input";
    titleInput.placeholder = "Axis title";
    titleInput.value = axis.title ?? "";
    titleInput.addEventListener("change", () => {
      props.onUpdateAxis({ axisId: axis.id, patch: { title: titleInput.value.trim() } });
    });

    const reassignSelect = document.createElement("select");
    reassignSelect.className = "inline-select";
    reassignSelect.add(new Option("Reassign traces: select target", ""));
    for (const candidate of props.axes) {
      if (candidate.id !== axis.id) {
        reassignSelect.add(new Option(formatAxisOptionLabel(props.axes, candidate.id), candidate.id));
      }
    }

    const moveUpButton = document.createElement("button");
    moveUpButton.type = "button";
    moveUpButton.className = "chip-button";
    moveUpButton.textContent = "Move Up";
    moveUpButton.disabled = index === 0;
    moveUpButton.addEventListener("click", () => {
      props.onReorderAxis({ axisId: axis.id, toIndex: index - 1 });
    });

    const moveDownButton = document.createElement("button");
    moveDownButton.type = "button";
    moveDownButton.className = "chip-button";
    moveDownButton.textContent = "Move Down";
    moveDownButton.disabled = index === props.axes.length - 1;
    moveDownButton.addEventListener("click", () => {
      props.onReorderAxis({ axisId: axis.id, toIndex: index + 1 });
    });

    const reassignButton = document.createElement("button");
    reassignButton.type = "button";
    reassignButton.className = "chip-button";
    reassignButton.textContent = "Reassign";
    reassignButton.disabled = props.axes.length < 2;
    reassignButton.addEventListener("click", () => {
      const target = reassignSelect.value as AxisId;
      if (!target) {
        return;
      }
      props.onReassignTraces({ fromAxisId: axis.id, toAxisId: target });
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "chip-button";
    removeButton.textContent = "Remove";
    removeButton.disabled = props.axes.length <= 1;
    removeButton.addEventListener("click", () => {
      const target = reassignSelect.value as AxisId;
      props.onRemoveAxis({
        axisId: axis.id,
        reassignToAxisId: target || undefined
      });
    });

    row.append(
      moveUpButton,
      moveDownButton,
      titleInput,
      reassignSelect,
      reassignButton,
      removeButton
    );
    addDropHandlers({
      target: row,
      canDropSignal: props.canDropSignal,
      parseDroppedSignal: props.parseDroppedSignal,
      onDropSignal: (signal) => props.onDropSignal({ signal, target: { kind: "axis", axisId: axis.id } })
    });
    props.container.appendChild(row);
  }

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "chip-button";
  addButton.textContent = "+ Axis";
  addButton.addEventListener("click", props.onAddAxis);
  props.container.appendChild(addButton);
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
      return;
    }
    event.preventDefault();
    options.onDropSignal(signal);
  });
}
