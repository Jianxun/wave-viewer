export type DatasetColumn = {
  name: string;
  values: number[];
};

export type Dataset = {
  path: string;
  rowCount: number;
  columns: DatasetColumn[];
};

export type DatasetMetadata = {
  path: string;
  rowCount: number;
  columns: Array<{ name: string }>;
};
