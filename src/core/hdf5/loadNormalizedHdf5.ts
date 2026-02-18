import { execFileSync } from "node:child_process";
import * as path from "node:path";

import type { Dataset } from "../dataset/types";

export type LoadedNormalizedHdf5Dataset = {
  dataset: Dataset;
};

type NormalizedHdf5LoaderOutput = {
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
    const requiredNode = (nodePath, message) => {
      try {
        const node = file.get(nodePath);
        if (!node) {
          fail(message ?? "missing required dataset '" + nodePath + "'.");
        }
        return node;
      } catch {
        fail(message ?? "missing required dataset '" + nodePath + "'.");
      }
    };

    const readAttr = (attrsOwner, key) => attrsOwner?.attrs?.[key]?.value;

    const vectorsPath = "/vectors";
    const vectorNamesPath = "/vector_names";

    requiredNode("/indep_var");
    requiredNode("/signals");
    const vectorsDataset = requiredNode(vectorsPath);
    const vectorNamesDataset = requiredNode(vectorNamesPath);

    const indepVarNameRaw = readAttr(file, "indep_var_name");
    const indepVarName =
      typeof indepVarNameRaw === "string" ? indepVarNameRaw.trim() : String(indepVarNameRaw ?? "").trim();
    if (indepVarName.length === 0) {
      fail("missing required file attribute 'indep_var_name'.");
    }
    requiredNode("/indep_var/" + indepVarName, "missing required dataset '/indep_var/" + indepVarName + "'.");

    const indepVarIndex = Number(readAttr(file, "indep_var_index"));
    if (!Number.isInteger(indepVarIndex) || indepVarIndex < 0) {
      fail("file attribute 'indep_var_index' must be a non-negative integer.");
    }

    const declaredNumPoints = Number(readAttr(file, "num_points"));
    if (!Number.isInteger(declaredNumPoints) || declaredNumPoints < 0) {
      fail("file attribute 'num_points' must be a non-negative integer.");
    }

    const declaredNumVariables = Number(readAttr(file, "num_variables"));
    if (!Number.isInteger(declaredNumVariables) || declaredNumVariables < 0) {
      fail("file attribute 'num_variables' must be a non-negative integer.");
    }

    const vectors = vectorsDataset.to_array();
    const vectorNames = vectorNamesDataset.to_array();

    if (!Array.isArray(vectors)) {
      fail("'" + vectorsPath + "' must be a 2D numeric dataset.");
    }
    if (!Array.isArray(vectorNames)) {
      fail("'" + vectorNamesPath + "' must be a 1D string dataset.");
    }

    const rowCount = vectors.length;
    if (rowCount !== declaredNumPoints) {
      fail(
        "file attribute 'num_points' (" + declaredNumPoints + ") must match '" + vectorsPath + "' row count (" + rowCount + ")."
      );
    }

    let columnCount = 0;
    for (let rowIndex = 0; rowIndex < vectors.length; rowIndex += 1) {
      const row = vectors[rowIndex];
      if (!Array.isArray(row)) {
        fail("'" + vectorsPath + "' must be a 2D numeric dataset.");
      }
      if (rowIndex === 0) {
        columnCount = row.length;
      } else if (row.length !== columnCount) {
        fail("'" + vectorsPath + "' rows must all have equal column count.");
      }
    }

    if (columnCount !== declaredNumVariables) {
      fail(
        "file attribute 'num_variables' (" +
          declaredNumVariables +
          ") must match '" +
          vectorsPath +
          "' column count (" +
          columnCount +
          ")."
      );
    }

    if (vectorNames.length !== columnCount) {
      fail(
        "'" +
          vectorNamesPath +
          "' length (" +
          vectorNames.length +
          ") must match '" +
          vectorsPath +
          "' column count (" +
          columnCount +
          ")."
      );
    }

    if (indepVarIndex >= columnCount) {
      fail("file attribute 'indep_var_index' is out of range for '" + vectorsPath + "' columns.");
    }

    const columnNames = vectorNames.map((rawName) => {
      if (typeof rawName !== "string" || rawName.trim().length === 0) {
        fail("'" + vectorNamesPath + "' entries must be non-empty strings.");
      }
      return rawName.trim();
    });

    if (columnNames[indepVarIndex] !== indepVarName) {
      fail(
        "file attributes 'indep_var_name' and 'indep_var_index' must reference the same vector name."
      );
    }

    const columns = columnNames.map((name, columnIndex) => {
      const values = vectors.map((row, rowIndex) => {
        const value = Number(row[columnIndex]);
        if (!Number.isFinite(value)) {
          fail(
            "'" + vectorsPath + "' contains non-numeric value at row " + rowIndex + ", column " + columnIndex + "."
          );
        }
        return value;
      });
      return { name, values };
    });

    console.log(
      JSON.stringify({
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
      // Ensure bare specifier resolution (for example "h5wasm/node") runs from extension root,
      // not the user's currently opened workspace folder.
      cwd: path.resolve(__dirname, ".."),
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

  return {
    dataset: {
      path: filePath,
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
