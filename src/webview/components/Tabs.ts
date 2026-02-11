import type { PlotState } from "../state/workspaceState";

export type TabsProps = {
  container: HTMLElement;
  plots: PlotState[];
  activePlotId: string;
  onSelect(plotId: string): void;
  onAdd(): void;
  onRename(plotId: string): void;
  onRemove(plotId: string): void;
};

export function renderTabs(props: TabsProps): void {
  props.container.replaceChildren();

  for (const plot of props.plots) {
    const item = document.createElement("div");
    item.className = "tab-item";

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = `plot-tab ${plot.id === props.activePlotId ? "active" : ""}`.trim();
    selectButton.setAttribute("role", "tab");
    selectButton.setAttribute("aria-selected", plot.id === props.activePlotId ? "true" : "false");
    selectButton.textContent = plot.name;
    selectButton.addEventListener("click", () => props.onSelect(plot.id));

    const renameButton = createActionButton("Rename", () => props.onRename(plot.id));
    const removeButton = createActionButton("Remove", () => props.onRemove(plot.id));

    item.append(selectButton, renameButton, removeButton);
    props.container.appendChild(item);
  }

  const addButton = createActionButton("+ Plot", props.onAdd);
  addButton.classList.add("tab-add-button");
  props.container.appendChild(addButton);
}

function createActionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
