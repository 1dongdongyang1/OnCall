export type DiskUsage = {
  node: string;
  filesystems: Array<{
    mountPoint: string;
    totalGb: number;
    usedGb: number;
    availableGb: number;
    usagePercent: number;
  }>;
};

export type DirectoryUsage = {
  node: string;
  path: string;
  entries: Array<{
    path: string;
    sizeGb: number;
    kind: "directory" | "file";
    inspectable: boolean;
  }>;
};

export type FileInspection = {
  node: string;
  path: string;
  sizeGb: number;
  owner: string;
  modifiedAt: string;
  observations: string[];
};

export interface DiskInspectionSource {
  getDiskUsage(node: string, signal?: AbortSignal): Promise<DiskUsage>;
  listLargeDirectories(
    node: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<DirectoryUsage>;
  inspectFile(
    node: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<FileInspection>;
}
