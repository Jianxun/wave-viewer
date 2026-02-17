import { execFileSync } from "node:child_process";

import type { Dataset } from "../dataset/types";

export type LoadedNormalizedHdf5Dataset = {
  dataset: Dataset;
  runId: string;
};

type NormalizedHdf5LoaderOutput = {
  runId: string;
  rowCount: number;
  columns: Array<{ name: string; values: number[] }>;
};

const HDF5_LOADER_SCRIPT = String.raw`
(async () => {
  const filePath = process.argv[1];
  if (!filePath) {
    throw new Error("Missing required HDF5 file path argument.");
  }

  const moduleExports = await import("h5wasm/node");
  const h5wasm = moduleExports.default ?? moduleExports;
  await h5wasm.ready;

  const fail = (message) => {
    throw new Error(
      message.startsWith("Invalid normalized HDF5 file:")
        ? message
        : "Invalid normalized HDF5 file: " + message
    );
  };

  const file = new h5wasm.File(filePath, "r");
  try {
    const requiredFileAttrs = ["created_by", "source_simulator", "source_file"];
    const format = file.attrs.format?.value;
    if (format !== "wave_viewer_hdf5") {
      fail("expected file attribute 'format' to equal 'wave_viewer_hdf5'.");
    }

    const formatVersion = file.attrs.format_version?.value;
    if (Number(formatVersion) !== 1) {
      fail("expected file attribute 'format_version' to equal 1.");
    }

    for (const requiredAttr of requiredFileAttrs) {
      if (file.attrs[requiredAttr]?.value === undefined) {
        fail("missing required file attribute '" + requiredAttr + "'.");
      }
    }

    const requiredNode = (nodePath) => {
      try {
        const node = file.get(nodePath);
        if (!node) {
          fail("missing required dataset '" + nodePath + "'.");
        }
        return node;
      } catch {
        fail("missing required dataset '" + nodePath + "'.");
      }
    };

    requiredNode("/runs");
    requiredNode("/catalog");
    const catalogRuns = requiredNode("/catalog/runs");
    const catalogRows = catalogRuns.to_array();

    if (!Array.isArray(catalogRows) || catalogRows.length === 0) {
      fail("'/catalog/runs' must contain at least one run descriptor.");
    }

    const firstRow = catalogRows[0];
    let runId;
    if (typeof firstRow === "string") {
      runId = firstRow;
    } else if (Array.isArray(firstRow)) {
      const members = catalogRuns.dtype?.compound_type?.members;
      const runIdIndex = Array.isArray(members)
        ? members.findIndex((member) => member?.name === "run_id")
        : -1;
      if (runIdIndex < 0) {
        fail("'/catalog/runs' compound records must include required field 'run_id'.");
      }
      runId = firstRow[runIdIndex];
    } else if (firstRow && typeof firstRow === "object" && "run_id" in firstRow) {
      runId = firstRow.run_id;
    }

    if (typeof runId !== "string" || runId.trim().length === 0) {
      fail("first '/catalog/runs' entry must include a non-empty string 'run_id'.");
    }

    const selectedRunId = runId.trim();
    const runPrefix = "/runs/" + selectedRunId;
    const runAttrs = requiredNode(runPrefix + "/attrs");

    const requiredRunAttrs = ["analysis_type", "point_count", "is_complex", "indep_name"];
    for (const requiredAttr of requiredRunAttrs) {
      if (runAttrs.attrs[requiredAttr]?.value === undefined) {
        fail("missing required attribute '/runs/" + selectedRunId + "/attrs:" + requiredAttr + "'.");
      }
    }

    if (Boolean(runAttrs.attrs.is_complex.value)) {
      fail("'/runs/" + selectedRunId + "/attrs:is_complex' true is not supported yet.");
    }

    const vectorsDataset = requiredNode(runPrefix + "/vectors");
    const vectorNamesDataset = requiredNode(runPrefix + "/vector_names");

    const vectors = vectorsDataset.to_array();
    const vectorNames = vectorNamesDataset.to_array();

    if (!Array.isArray(vectors)) {
      fail("'" + runPrefix + "/vectors' must be a 2D numeric dataset.");
    }
    if (!Array.isArray(vectorNames)) {
      fail("'" + runPrefix + "/vector_names' must be a 1D string dataset.");
    }

    const rowCount = vectors.length;
    const declaredPointCount = Number(runAttrs.attrs.point_count.value);
    if (!Number.isFinite(declaredPointCount) || declaredPointCount < 0) {
      fail("'/runs/" + selectedRunId + "/attrs:point_count' must be a non-negative integer.");
    }
    if (rowCount !== declaredPointCount) {
      fail(
        "'" + runPrefix + "/attrs:point_count' (" + declaredPointCount + ") must match '/runs/" +
          selectedRunId +
          "/vectors' row count (" +
          rowCount +
          ")."
      );
    }

    let columnCount = 0;
    for (let rowIndex = 0; rowIndex < vectors.length; rowIndex += 1) {
      const row = vectors[rowIndex];
      if (!Array.isArray(row)) {
        fail("'" + runPrefix + "/vectors' must be a 2D numeric dataset.");
      }
      if (rowIndex === 0) {
        columnCount = row.length;
      } else if (row.length !== columnCount) {
        fail("'" + runPrefix + "/vectors' rows must all have equal column count.");
      }
    }

    if (vectorNames.length !== columnCount) {
      fail(
        "'" + runPrefix +
          "/vector_names' length (" +
          vectorNames.length +
          ") must match '" +
          runPrefix +
          "/vectors' column count (" +
          columnCount +
          ")."
      );
    }

    const columns = vectorNames.map((rawName, columnIndex) => {
      if (typeof rawName !== "string" || rawName.trim().length === 0) {
        fail("'" + runPrefix + "/vector_names' entries must be non-empty strings.");
      }
      const name = rawName.trim();
      const values = vectors.map((row, rowIndex) => {
        const value = Number(row[columnIndex]);
        if (!Number.isFinite(value)) {
          fail(
            "'" + runPrefix +
              "/vectors' contains non-numeric value at row " +
              rowIndex +
              ", column " +
              columnIndex +
              "."
          );
        }
        return value;
      });
      return { name, values };
    });

    console.log(
      JSON.stringify({
        runId: selectedRunId,
        rowCount,
        columns
      })
    );
  } finally {
    file.close();
  }
})().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
`;

export function isHdf5DatasetFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".h5");
}

export function loadNormalizedHdf5Dataset(filePath: string): LoadedNormalizedHdf5Dataset {
  let stdout = "";
  try {
    stdout = execFileSync(process.execPath, ["-e", HDF5_LOADER_SCRIPT, filePath], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (error) {
    const details = extractExecErrorMessage(error);
    throw new Error(details);
  }

  let parsed: NormalizedHdf5LoaderOutput;
  try {
    parsed = JSON.parse(stdout) as NormalizedHdf5LoaderOutput;
  } catch {
    throw new Error(`Failed to parse normalized HDF5 loader output for '${filePath}'.`);
  }

  if (!Array.isArray(parsed.columns)) {
    throw new Error(`Invalid normalized HDF5 loader output for '${filePath}': missing columns.`);
  }

  const runId = typeof parsed.runId === "string" ? parsed.runId : "";
  if (runId.trim().length === 0) {
    throw new Error(`Invalid normalized HDF5 loader output for '${filePath}': missing run_id.`);
  }

  return {
    runId,
    dataset: {
      path: `${filePath}#${runId}`,
      rowCount: parsed.rowCount,
      columns: parsed.columns
    }
  };
}

function extractExecErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return `Failed to load normalized HDF5 dataset: ${String(error)}`;
  }

  const maybeError = error as {
    stderr?: string | Buffer;
    stdout?: string | Buffer;
    message?: string;
  };

  const stderr =
    typeof maybeError.stderr === "string"
      ? maybeError.stderr.trim()
      : maybeError.stderr?.toString("utf8").trim() ?? "";
  if (stderr.length > 0) {
    return stderr;
  }

  const stdout =
    typeof maybeError.stdout === "string"
      ? maybeError.stdout.trim()
      : maybeError.stdout?.toString("utf8").trim() ?? "";
  if (stdout.length > 0) {
    return stdout;
  }

  if (typeof maybeError.message === "string" && maybeError.message.trim().length > 0) {
    return maybeError.message;
  }

  return "Failed to load normalized HDF5 dataset.";
}
