import type { Dataset } from "../dataset/types";

export type ParseCsvInput = {
  path: string;
  csvText: string;
};

export type SerializeDatasetToCsvInput = {
  dataset: Dataset;
  signalNames: readonly string[];
};

export function parseCsv(input: ParseCsvInput): Dataset {
  const lines = splitCsvLines(input.csvText);
  if (lines.length === 0) {
    throw new Error(`CSV file ${input.path} is empty or missing a header row.`);
  }

  const headers = splitCsvLine(lines[0]);
  if (headers.length === 0 || headers.some((header) => header.length === 0)) {
    throw new Error(`CSV file ${input.path} has an invalid header row.`);
  }

  const rawRows: string[][] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    if (rawLine.trim().length === 0) {
      throw new Error(
        `Malformed CSV row ${lineIndex + 1} in ${input.path}: expected ${headers.length} columns, got 0.`
      );
    }

    const row = splitCsvLine(rawLine);
    if (row.length !== headers.length) {
      throw new Error(
        `Malformed CSV row ${lineIndex + 1} in ${input.path}: expected ${headers.length} columns, got ${row.length}.`
      );
    }

    rawRows.push(row);
  }

  const numericColumns = headers
    .map((header, columnIndex) => {
      const values: number[] = [];
      for (const row of rawRows) {
        const valueText = row[columnIndex].trim();
        if (valueText.length === 0) {
          return null;
        }
        const parsed = Number(valueText);
        if (!Number.isFinite(parsed)) {
          return null;
        }
        values.push(parsed);
      }

      return { name: header, values };
    })
    .filter((column): column is { name: string; values: number[] } => column !== null);

  if (numericColumns.length === 0) {
    throw new Error(`CSV file ${input.path} has no numeric columns to plot.`);
  }

  return {
    path: input.path,
    rowCount: rawRows.length,
    columns: numericColumns
  };
}

export function serializeDatasetToCsv(input: SerializeDatasetToCsvInput): string {
  const selectedColumns = input.signalNames.map((signalName) => {
    const column = input.dataset.columns.find((candidate) => candidate.name === signalName);
    if (!column) {
      throw new Error(`Missing dataset signal column '${signalName}' for CSV export.`);
    }
    if (column.values.length !== input.dataset.rowCount) {
      throw new Error(
        `Signal column '${signalName}' has ${column.values.length} samples, expected ${input.dataset.rowCount}.`
      );
    }
    return column;
  });

  const lines: string[] = [selectedColumns.map((column) => column.name).join(",")];
  for (let rowIndex = 0; rowIndex < input.dataset.rowCount; rowIndex += 1) {
    lines.push(selectedColumns.map((column) => String(column.values[rowIndex])).join(","));
  }

  return `${lines.join("\n")}\n`;
}

function splitCsvLines(csvText: string): string[] {
  const lines = csvText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
    lines.pop();
  }
  return lines;
}

function splitCsvLine(line: string): string[] {
  return line.split(",").map((value) => value.trim());
}
