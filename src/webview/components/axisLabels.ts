import type { AxisId, AxisState } from "../state/workspaceState";

export function getLaneNumber(axes: AxisState[], axisId: AxisId): number | undefined {
  const index = axes.findIndex((axis) => axis.id === axisId);
  if (index < 0) {
    return undefined;
  }
  return index + 1;
}

export function formatAxisOptionLabel(axes: AxisState[], axisId: AxisId): string {
  const laneNumber = getLaneNumber(axes, axisId);
  if (laneNumber === undefined) {
    return axisId.toUpperCase();
  }
  return `${axisId.toUpperCase()} (Lane ${laneNumber})`;
}

export function formatAxisLaneLabel(axes: AxisState[], axis: AxisState): string {
  const laneNumber = getLaneNumber(axes, axis.id);
  if (laneNumber === undefined) {
    return axis.id.toUpperCase();
  }

  const isTop = laneNumber === 1;
  const isBottom = laneNumber === axes.length;
  const position = isTop ? "Top" : isBottom ? "Bottom" : "Middle";
  return `${axis.id.toUpperCase()} - Lane ${laneNumber} (${position})`;
}
