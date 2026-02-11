declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

type PlotTab = {
  id: string;
  name: string;
};

type UiState = {
  tabs: PlotTab[];
  activeTabId: string;
};

type HostMessage =
  | { type: "host/init"; payload: { title: string } }
  | { type: "host/datasetLoaded"; payload: { path: string; fileName: string } };

const vscode = acquireVsCodeApi();

const state: UiState = {
  tabs: [
    { id: "plot-1", name: "Plot 1" },
    { id: "plot-2", name: "Plot 2" }
  ],
  activeTabId: "plot-1"
};

const tabsEl = getRequiredElement("plot-tabs");
const activePlotTitleEl = getRequiredElement("active-plot-title");
const bridgeStatusEl = getRequiredElement("bridge-status");
const datasetStatusEl = getRequiredElement("dataset-status");

function getRequiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }

  return element;
}

function renderTabs(): void {
  tabsEl.replaceChildren();

  for (const tab of state.tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `plot-tab ${tab.id === state.activeTabId ? "active" : ""}`.trim();
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", tab.id === state.activeTabId ? "true" : "false");
    button.dataset.tabId = tab.id;
    button.textContent = tab.name;
    button.addEventListener("click", () => setActiveTab(tab.id));
    tabsEl.appendChild(button);
  }

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  activePlotTitleEl.textContent = activeTab?.name ?? "Untitled Plot";
}

function setActiveTab(tabId: string): void {
  if (state.activeTabId === tabId) {
    return;
  }

  state.activeTabId = tabId;
  renderTabs();
}

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;

  if (message.type === "host/init") {
    bridgeStatusEl.textContent = `Connected: ${message.payload.title}`;
    return;
  }

  if (message.type === "host/datasetLoaded") {
    datasetStatusEl.textContent = `Loaded ${message.payload.fileName} (${message.payload.path})`;
  }
});

renderTabs();
vscode.postMessage({ type: "webview/ready" });
