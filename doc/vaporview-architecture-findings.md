# VaporView Architecture Findings and Adoption Plan

Date: 2026-02-11  
Inspected clone: `/tmp/vaporview` (cloned from `https://github.com/Lramseyer/vaporview`)

## What VaporView does architecturally

### 1) Split UX into two surfaces
- Side panel for discovery/navigation:
  - Dedicated Activity Bar container and tree view.
  - `package.json` contributes:
    - `viewsContainers.activitybar` id `vaporViewActivityBar`
    - view id `waveformViewerNetlistView`
- Main editor for interaction:
  - Custom editor `viewType: vaporview.waveformViewer`.
  - Registered through `registerCustomEditorProvider(...)`.

This is the key pattern: browse in side panel, manipulate in main viewer.

### 2) Keep a message bridge as the integration seam
- Extension host owns document lifecycle and state.
- Webview focuses on rendering + interaction.
- Commands/events flow both directions via `webview.postMessage` and `onDidReceiveMessage`.

### 3) Use drop handling at the webview boundary
- Webview handles drag/drop and sends one normalized drop message (`handleDrop`) with:
  - target group/path
  - drop index
  - resource URI list
- Extension resolves dropped resources into domain items, then mutates document state.

### 4) Separate parsing/data from UI
- Parser abstraction (`WaveformFileParser`) isolates file-format backends.
- UI does not know whether data came from wasm/fsdb/remote implementations.

### 5) Strong command/context model
- Rich command + keybinding + context menu surface in `package.json`.
- Supports quick actions, keyboard-first operation, and context-specific menus.

## Why this is relevant to Wave Viewer

Current Wave Viewer keeps signal list + controls + canvas in one webview layout.  
That works for MVP, but it couples discovery and manipulation too tightly and makes high-volume signal workflows awkward.

VaporView’s split architecture directly addresses this:
- Side panel handles scale (search/select/add/reveal signals).
- Main canvas can stay focused on plotting and axis assignment.
- Drag/drop and command bridge become first-class interaction paths.

## Recommended adoption path for Wave Viewer

## Phase 1: Introduce a side-panel signal browser (no breaking changes)
- Add a contributed view container + tree view in `package.json`.
- Build a `TreeDataProvider` for dataset numeric signals (and optional grouping by prefix/path).
- Keep current webview controls temporarily; the side panel is additive.

Expected Wave Viewer changes:
- `src/extension.ts`:
  - register/create tree view
  - wire add/remove/reveal commands
- new files (suggested):
  - `src/extension/signalTree.ts`
  - `src/extension/viewerBridge.ts`

## Phase 2: Add drag/drop from side panel to plot lanes/domains
- Use VS Code resource URIs or custom payload format for dragged signal items.
- Webview receives drop, resolves target lane/domain, sends normalized event to extension host.
- Host applies existing actions (`trace/add`, optional `axis/add`) and notifies webview.

Expected Wave Viewer changes:
- `src/webview/main.ts`:
  - drop listeners + target resolution
- `src/webview/plotly/adapter.ts`:
  - expose lane-domain metadata for hit-testing
- `src/webview/styles.css` + `src/webview/index.html`:
  - drop overlays/highlights

## Phase 3: Move signal-management ergonomics to side panel
- Promote side panel actions:
  - add to selected axis / active lane
  - remove from plot
  - reveal current traces
  - multi-select batch add
- Simplify webview left-pane controls once side panel workflows are stable.

## Phase 4: Keyboard + command polish
- Add keybindings:
  - zoom-to-fit (`Ctrl/Cmd+0`)
  - cancel gesture (`Esc`)
  - quick add/remove selected signals
- Add context menus for trace/lane actions in webview.

## Design constraints to preserve

- Keep existing deterministic replay contract:
  - workspace state remains source of truth.
  - UI interaction methods should converge to the same reducer actions.
- Keep single-figure shared-`xaxis` + domain-stacked `yaxis*` architecture.
- Keep webview/host protocol explicit and versionable.

## Proposed minimal target architecture for Wave Viewer

1. Extension host
- Dataset load/parsing
- Signal tree provider
- Command registration
- Webview panel lifecycle and message bridge

2. Webview
- Plot rendering and interactions
- Drop target mapping to axes/domains
- Dispatching workspace actions

3. Shared protocol/types
- Message contracts for:
  - `host/datasetLoaded`, `host/workspaceLoaded`
  - `webview/workspaceChanged`
  - `webview/dropSignal`
  - optional `host/signalSelectionChanged`

## Suggested first implementation slice

Implement this first for maximum UX gain with low risk:
- Add side-panel signal tree.
- Support:
  - double-click signal -> add trace to active axis
  - context menu “Add to Plot”
  - drag signal from side panel -> drop on axis row in webview
- Keep current signal list UI until this path is stable.

This gives immediate ergonomics improvement without requiring a large refactor.
