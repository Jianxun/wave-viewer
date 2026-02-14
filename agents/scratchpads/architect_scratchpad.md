# Architect Scratchpad

Date: 2026-02-13
Topic: Multi-viewer workflow and explicit layout binding

## Current Concerns
- Viewer-to-layout association is implicit and confusing in multi-viewer usage.
- `Open Layout` is focus-sensitive and can apply to an unintended viewer.
- Users cannot easily tell which YAML file a viewer is currently bound to.
- Some commands currently mix "reuse existing viewer" and "create fresh viewer" behavior.

## Observations From Current Implementation
- Viewer sessions carry `datasetPath` + `layoutUri` in host state.
- Fallback layout binding is derived from dataset path when explicit layout is not set.
- Webview status currently shows viewer readiness but not the bound layout path.

## Desired Direction (Working)
- Make session binding explicit in UI: viewer id, dataset, layout file.
- Add a dedicated fresh-viewer command that never retargets existing viewers.
- Add a dedicated fresh-viewer-from-layout command that always binds the selected YAML to the new viewer.
- Keep explicit semantics between:
  - "reuse/focus viewer" command
  - "open new viewer" command
  - "apply layout to focused viewer" command (if retained)

## Candidate Commands
- `waveViewer.openViewer` (existing convenience/reuse path)
- `waveViewer.openNewViewer` (new, always fresh panel)
- `waveViewer.openNewViewerFromLayout` (new, always fresh panel + explicit layout bind)
- `waveViewer.openLayout` (possibly rename to clarify focused-viewer apply semantics)

## Open Questions
- Should `openLayout` remain, or be renamed/deprecated in favor of clearer commands?
- Should applying a layout to a focused viewer require confirmation?
- How should fallback layout naming be communicated in the UI?
- Should layout binding be immutable per viewer session unless user explicitly rebinds?

## Next Session Plan
- Finalize command taxonomy and semantics.
- Define protocol payload update for explicit layout binding in webview messages.
- Define minimal UI change for bound-layout visibility.
- Sequence implementation in small, testable slices.
