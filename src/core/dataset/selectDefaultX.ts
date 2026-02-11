import type { Dataset } from "./types";

export function selectDefaultX(dataset: Dataset): string {
  const timeColumn = dataset.columns.find((column) => column.name === "time");
  if (timeColumn) {
    return timeColumn.name;
  }

  const firstNumericColumn = dataset.columns[0];
  if (!firstNumericColumn) {
    throw new Error("Cannot select default X signal because dataset has no numeric columns.");
  }

  return firstNumericColumn.name;
}
