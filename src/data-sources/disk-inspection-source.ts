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
    inspectable: boolean;
  }>;
};

export interface DiskInspectionSource {
  getDiskUsage(node: string): Promise<DiskUsage>;
  listLargeDirectories(node: string, path: string): Promise<DirectoryUsage>;
}
