# Domain-Stacked Shared-X Implementation Spec

## Purpose
Provide an unambiguous implementation target for ADR-0002.

## Non-negotiable rules
- Each plot tab renders as exactly one Plotly figure.
- Figure has exactly one `xaxis` and one `xaxis.rangeslider`.
- `yaxis`, `yaxis2`, `yaxis3`, ... are rendered as non-overlapping vertical domains.
- Do not implement multi-canvas subplot synchronization.
- Do not implement `overlaying: "y"` lane behavior.

## Canonical mapping
- Axis id mapping:
  - `y1 -> yaxis`
  - `yN -> yaxisN` (`N >= 2`)
- Trace mapping:
  - `trace.axisId` selects `y`, `y2`, `y3`, ...
  - `x = columns[plot.xSignal]`
  - `y = columns[trace.signal]`

## Domain layout algorithm
- Inputs:
  - axis order from `plot.axes[]`
  - lane count `n`
  - fixed gap `g = 0.04`
- Rules:
  - if `n == 1`, domain is `[0, 1]`
  - else:
    - `h = (1 - g * (n - 1)) / n`
    - lane 0 is top-most, lane `n-1` is bottom-most
    - each lane gets `[bottom, top]` with no overlap
- Clamp domain values to `[0, 1]`.

## Interaction behavior
- Axis order changes update top-to-bottom lane order.
- X zoom/pan updates only `plot.xRange`.
- Y zoom/pan updates only the specific lane axis range (`axis.range`).
- Autorange reset clears corresponding stored range (`undefined`).

## State model deltas
- `AxisState` must not require `side` for lane rendering.
- `AxisState` must include:
  - `id`
  - `title?`
  - `range?`
  - `scale?`
- `PlotState.axes[]` order is rendering order.

## YAML spec requirements
- Preserve deterministic order:
  - `plots[]` order
  - `axes[]` order
  - `traces[]` order
- Export/import must preserve all rendering-affecting fields for the model above.
- Import errors must enumerate missing signals and invalid axis references.

## Acceptance checklist
- Visual:
  - Multiple lanes are stacked vertically, not overlaid.
  - One rangeslider controls all lanes.
- Data:
  - Same signal can appear in multiple lanes as separate trace instances.
  - Re-export after import is stable for deterministic fields.
- Tests:
  - Adapter tests assert domain generation and axis mapping.
  - Spec tests assert round-trip determinism and validation failures.
