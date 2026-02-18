import { execFileSync } from "node:child_process";
import * as path from "node:path";

import {
  COMPLEX_SIGNAL_ACCESSORS,
  parseComplexSignalReference,
  type ComplexSignalAccessor,
  type Dataset
} from "../dataset/types";

export type Hdf5SignalValueProjection = {
  kind: "real";
  values: number[];
} | {
  kind: "complex";
  re: number[];
  im: number[];
};

export type LoadedNormalizedHdf5Dataset = {
  dataset: Dataset;
  signalPaths: string[];
  signalAliasLookup: Record<string, string>;
  complexSignalPaths: string[];
  resolveSignalValues(signal: string): number[] | undefined;
};

type NormalizedHdf5LoaderOutput = {
  rowCount: number;
  columns: Array<{ name: string; values: number[] }>;
  signalPaths: string[];
  signalAliasLookup: Record<string, string>;
  complexSignalPaths: string[];
  signalDataByPath: Record<string, Hdf5SignalValueProjection>;
};

const DB20_EPS = 1e-30;

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

    const indepVarGroup = requiredNode("/indep_var");
    const signalsGroup = requiredNode("/signals");
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

    if (indepVarGroup?.constructor?.name !== "Group") {
      fail("'/indep_var' must be an HDF5 group.");
    }
    if (signalsGroup?.constructor?.name !== "Group") {
      fail("'/signals' must be an HDF5 group.");
    }

    const decodeSample = (sample, rowIndex, columnIndex) => {
      if (typeof sample === "number" && Number.isFinite(sample)) {
        return { kind: "real", value: sample };
      }

      if (Array.isArray(sample)) {
        if (
          sample.length === 1 &&
          typeof sample[0] === "number" &&
          Number.isFinite(sample[0])
        ) {
          return { kind: "real", value: sample[0] };
        }

        if (
          sample.length === 2 &&
          typeof sample[0] === "number" &&
          typeof sample[1] === "number" &&
          Number.isFinite(sample[0]) &&
          Number.isFinite(sample[1])
        ) {
          return {
            kind: "complex",
            re: sample[0],
            im: sample[1]
          };
        }
      }

      fail(
        "'" +
          vectorsPath +
          "' contains unsupported sample encoding at row " +
          rowIndex +
          ", column " +
          columnIndex +
          ". Expected finite scalar or complex pair [re, im]."
      );
    };

    const decodedColumnCache = new Map();
    const decodeColumn = (columnIndex) => {
      if (decodedColumnCache.has(columnIndex)) {
        return decodedColumnCache.get(columnIndex);
      }

      let columnKind = null;
      const values = [];
      const re = [];
      const im = [];
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const sample = decodeSample(vectors[rowIndex][columnIndex], rowIndex, columnIndex);
        if (columnKind === null) {
          columnKind = sample.kind;
        }
        if (sample.kind !== columnKind) {
          fail(
            "'" +
              vectorsPath +
              "' column " +
              columnIndex +
              " mixes scalar and complex sample encodings."
          );
        }
        if (sample.kind === "real") {
          values.push(sample.value);
        } else {
          re.push(sample.re);
          im.push(sample.im);
        }
      }

      const decoded =
        columnKind === "complex"
          ? { kind: "complex", re, im }
          : { kind: "real", values };
      decodedColumnCache.set(columnIndex, decoded);
      return decoded;
    };

    const indepDecoded = decodeColumn(indepVarIndex);
    let indepValues;
    if (indepDecoded.kind === "real") {
      indepValues = indepDecoded.values;
    } else {
      const maxAbsImag = indepDecoded.im.reduce(
        (max, value) => Math.max(max, Math.abs(value)),
        0
      );
      const maxAbsReal = indepDecoded.re.reduce(
        (max, value) => Math.max(max, Math.abs(value)),
        0
      );
      const imagTolerance = Math.max(1e-12, maxAbsReal * 1e-9);
      if (maxAbsImag > imagTolerance) {
        fail(
          "independent variable '" +
            indepVarName +
            "' has significant imaginary content in '/vectors' column " +
            indepVarIndex +
            " (max |imag| = " +
            maxAbsImag +
            ", tolerance = " +
            imagTolerance +
            ")."
        );
      }
      indepValues = indepDecoded.re;
    }

    const signalLeaves = [];
    const collectSignalLeaves = (groupNode, groupPathSegments) => {
      const childNames = Array.isArray(groupNode.keys()) ? groupNode.keys().slice().sort() : [];
      for (const childName of childNames) {
        const child = groupNode.get(childName);
        const childPathSegments = [...groupPathSegments, childName];
        const childPath = childPathSegments.join("/");
        const childKind = child?.constructor?.name;

        if (childKind === "Group") {
          collectSignalLeaves(child, childPathSegments);
          continue;
        }

        if (childKind !== "Dataset") {
          fail(
            "signal tree node '/signals/" +
              childPath +
              "' must be a dataset or group."
          );
        }

        const indexValue = Number(readAttr(child, "index"));
        if (!Number.isInteger(indexValue) || indexValue < 0) {
          fail(
            "signal dataset '/signals/" +
              childPath +
              "' must define non-negative integer attribute 'index'."
          );
        }
        if (indexValue >= columnCount) {
          fail(
            "signal dataset '/signals/" +
              childPath +
              "' attribute 'index' is out of range for '" +
              vectorsPath +
              "' columns."
          );
        }

        const originalNameRaw = readAttr(child, "original_name");
        const originalName =
          typeof originalNameRaw === "string" && originalNameRaw.trim().length > 0
            ? originalNameRaw.trim()
            : columnNames[indexValue];

        signalLeaves.push({
          signalPath: childPath,
          columnIndex: indexValue,
          canonicalName: originalName
        });
      }
    };
    collectSignalLeaves(signalsGroup, []);

    if (signalLeaves.length === 0) {
      fail("'/signals' must contain at least one signal dataset.");
    }

    const seenSignalNames = new Set();
    const columns = [
      {
        name: indepVarName,
        values: indepValues
      }
    ];
    const signalPaths = [];
    const signalAliasLookup = {};
    const complexSignalPaths = [];
    const signalDataByPath = {};

    for (const leaf of signalLeaves) {
      if (typeof leaf.signalPath !== "string" || leaf.signalPath.trim().length === 0) {
        fail("signal dataset paths under '/signals' must be non-empty.");
      }
      const signalPath = leaf.signalPath.trim();
      if (seenSignalNames.has(signalPath)) {
        fail("duplicate signal path '" + signalPath + "' under '/signals'.");
      }
      seenSignalNames.add(signalPath);
      signalPaths.push(signalPath);

      const decoded = decodeColumn(leaf.columnIndex);
      if (decoded.kind === "real") {
        columns.push({
          name: signalPath,
          values: decoded.values
        });
        signalDataByPath[signalPath] = {
          kind: "real",
          values: decoded.values
        };
      } else {
        complexSignalPaths.push(signalPath);
        signalDataByPath[signalPath] = {
          kind: "complex",
          re: decoded.re,
          im: decoded.im
        };
      }

      const alias = typeof leaf.canonicalName === "string" ? leaf.canonicalName.trim() : "";
      if (alias.length > 0 && alias !== signalPath) {
        signalAliasLookup[alias] = signalPath;
      }
    }

    if (seenSignalNames.has(indepVarName)) {
      fail(
        "independent variable name '" +
          indepVarName +
          "' conflicts with a '/signals' path."
      );
    }

    columns.forEach((column, index) => {
      if (column.values.length !== rowCount) {
        fail(
          "resolved column '" +
            column.name +
            "' at index " +
            index +
            " has invalid length (" +
            column.values.length +
            ")."
        );
      }
    });

    console.log(
      JSON.stringify({
        rowCount,
        columns,
        signalPaths,
        signalAliasLookup,
        complexSignalPaths,
        signalDataByPath
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
  if (!Array.isArray(parsed.signalPaths)) {
    throw new Error(`Invalid normalized HDF5 loader output for '${filePath}': missing signalPaths.`);
  }
  if (
    typeof parsed.signalAliasLookup !== "object" ||
    parsed.signalAliasLookup === null ||
    Array.isArray(parsed.signalAliasLookup)
  ) {
    throw new Error(`Invalid normalized HDF5 loader output for '${filePath}': missing signalAliasLookup.`);
  }
  if (!Array.isArray(parsed.complexSignalPaths)) {
    throw new Error(`Invalid normalized HDF5 loader output for '${filePath}': missing complexSignalPaths.`);
  }
  if (!isRecord(parsed.signalDataByPath)) {
    throw new Error(`Invalid normalized HDF5 loader output for '${filePath}': missing signalDataByPath.`);
  }

  for (const column of parsed.columns) {
    if (!isRecord(column) || typeof column.name !== "string" || !isFiniteNumericArray(column.values)) {
      throw new Error(`Invalid normalized HDF5 loader output for '${filePath}': invalid runtime column values.`);
    }
  }

  const signalDataByPath = validateSignalDataByPath(parsed.signalDataByPath, parsed.rowCount, filePath);

  return {
    dataset: {
      path: filePath,
      rowCount: parsed.rowCount,
      columns: parsed.columns
    },
    signalPaths: parsed.signalPaths,
    signalAliasLookup: parsed.signalAliasLookup,
    complexSignalPaths: parsed.complexSignalPaths,
    resolveSignalValues: (signal) => resolveSignalValues(signal, signalDataByPath)
  };
}

function validateSignalDataByPath(
  value: Record<string, unknown>,
  rowCount: number,
  filePath: string
): Record<string, Hdf5SignalValueProjection> {
  const validated: Record<string, Hdf5SignalValueProjection> = {};

  for (const [signalPath, rawSignalData] of Object.entries(value)) {
    if (!isRecord(rawSignalData)) {
      throw new Error(
        `Invalid normalized HDF5 loader output for '${filePath}': invalid signal data for '${signalPath}'.`
      );
    }

    if (rawSignalData.kind === "real") {
      if (!isFiniteNumericArray(rawSignalData.values) || rawSignalData.values.length !== rowCount) {
        throw new Error(
          `Invalid normalized HDF5 loader output for '${filePath}': invalid real signal values for '${signalPath}'.`
        );
      }
      validated[signalPath] = {
        kind: "real",
        values: rawSignalData.values
      };
      continue;
    }

    if (rawSignalData.kind === "complex") {
      if (
        !isFiniteNumericArray(rawSignalData.re) ||
        !isFiniteNumericArray(rawSignalData.im) ||
        rawSignalData.re.length !== rowCount ||
        rawSignalData.im.length !== rowCount
      ) {
        throw new Error(
          `Invalid normalized HDF5 loader output for '${filePath}': invalid complex signal values for '${signalPath}'.`
        );
      }
      validated[signalPath] = {
        kind: "complex",
        re: rawSignalData.re,
        im: rawSignalData.im
      };
      continue;
    }

    throw new Error(
      `Invalid normalized HDF5 loader output for '${filePath}': unknown signal kind for '${signalPath}'.`
    );
  }

  return validated;
}

function resolveSignalValues(
  signal: string,
  signalDataByPath: Record<string, Hdf5SignalValueProjection>
): number[] | undefined {
  const { base, accessor } = parseComplexSignalReference(signal);
  if (base.length === 0) {
    return undefined;
  }

  const signalData = signalDataByPath[base];
  if (!signalData) {
    return undefined;
  }

  if (!accessor) {
    if (signalData.kind === "real") {
      return signalData.values;
    }
    throw new Error(
      `Cannot project complex signal '${base}' without accessor. Use one of: ${COMPLEX_SIGNAL_ACCESSORS.map((next) => `.${next}`).join(", ")}.`
    );
  }

  if (signalData.kind === "real") {
    throw new Error(
      `Signal '${base}' is real-valued and does not support accessor '.${accessor}'.`
    );
  }

  return projectComplexSignalAccessor(base, accessor, signalData.re, signalData.im);
}

function projectComplexSignalAccessor(
  baseSignal: string,
  accessor: ComplexSignalAccessor,
  reValues: number[],
  imValues: number[]
): number[] {
  if (reValues.length !== imValues.length) {
    throw new Error(`Complex projection failed for '${baseSignal}.${accessor}': mismatched re/im lengths.`);
  }

  const projected = new Array<number>(reValues.length);
  for (let index = 0; index < reValues.length; index += 1) {
    const re = reValues[index];
    const im = imValues[index];
    let value = 0;

    if (accessor === "re") {
      value = re;
    } else if (accessor === "im") {
      value = im;
    } else if (accessor === "mag") {
      value = Math.hypot(re, im);
    } else if (accessor === "phase") {
      value = (Math.atan2(im, re) * 180) / Math.PI;
    } else {
      const magnitude = Math.hypot(re, im);
      value = 20 * Math.log10(Math.max(magnitude, DB20_EPS));
    }

    if (!Number.isFinite(value)) {
      throw new Error(
        `Complex projection failed for '${baseSignal}.${accessor}' at sample ${index}: non-finite result.`
      );
    }

    projected[index] = value;
  }

  return projected;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumericArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}
