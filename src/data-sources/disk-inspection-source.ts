export type DiskUsage = {
  filesystems: Array<{
    mountPoint: string;
    totalGb: number;
    usedGb: number;
    availableGb: number;
    usagePercent: number;
  }>;
};

export type DirectoryUsage = {
  path: string;
  entries: Array<{
    path: string;
    sizeGb: number;
  }>;
};

export interface DiskInspectionSource {
  getDiskUsage(): Promise<DiskUsage>;
  listLargeDirectories(path: string): Promise<DirectoryUsage>;
}
