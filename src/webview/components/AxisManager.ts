import type { AxisId, AxisState } from "../state/workspaceState";

export type AxisManagerProps = {
  container: HTMLElement;
  axes: AxisState[];
  onAddAxis(): void;
  onRemoveAxis(payload: { axisId: AxisId; reassignToAxisId?: AxisId }): void;
  onReassignTraces(payload: { fromAxisId: AxisId; toAxisId: AxisId }): void;
  onUpdateAxis(payload: { axisId: AxisId; patch: Partial<Omit<AxisState, "id">> }): void;
};

export function renderAxisManager(props: AxisManagerProps): void {
  props.container.replaceChildren();

  for (const axis of props.axes) {
    const row = document.createElement("div");
    row.className = "list-row axis-row";

    const label = document.createElement("span");
    label.className = "signal-name";
    label.textContent = axis.id.toUpperCase();

    const sideSelect = document.createElement("select");
    sideSelect.className = "inline-select";
    sideSelect.add(new Option("Left", "left", axis.side === "left"));
    sideSelect.add(new Option("Right", "right", axis.side === "right"));
    sideSelect.addEventListener("change", () => {
      props.onUpdateAxis({ axisId: axis.id, patch: { side: sideSelect.value as "left" | "right" } });
    });

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
    reassignSelect.add(new Option("Keep", ""));
    for (const candidate of props.axes) {
      if (candidate.id !== axis.id) {
        reassignSelect.add(new Option(`Move traces -> ${candidate.id.toUpperCase()}`, candidate.id));
      }
    }

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

    row.append(label, sideSelect, titleInput, reassignSelect, reassignButton, removeButton);
    props.container.appendChild(row);
  }

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "chip-button";
  addButton.textContent = "+ Axis";
  addButton.addEventListener("click", props.onAddAxis);
  props.container.appendChild(addButton);
}
