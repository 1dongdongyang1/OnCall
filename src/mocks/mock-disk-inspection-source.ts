import type {
  DirectoryUsage,
  DiskInspectionSource,
  DiskUsage,
} from "../data-sources/disk-inspection-source.js";

const diskUsage: DiskUsage = {
  filesystems: [
    {
      mountPoint: "/",
      totalGb: 100,
      usedGb: 95,
      availableGb: 5,
      usagePercent: 95,
    },
  ],
};

const directoryUsage: Record<string, DirectoryUsage> = {
  "/": {
    path: "/",
    entries: [
      { path: "/var", sizeGb: 72 },
      { path: "/usr", sizeGb: 14 },
      { path: "/home", sizeGb: 6 },
    ],
  },
  "/var": {
    path: "/var",
    entries: [
      { path: "/var/log", sizeGb: 65 },
      { path: "/var/lib", sizeGb: 5 },
      { path: "/var/cache", sizeGb: 2 },
    ],
  },
};

export const mockDiskInspectionSource: DiskInspectionSource = {
  getDiskUsage: async () => structuredClone(diskUsage),
  listLargeDirectories: async (path) => {
    const result = directoryUsage[path];

    if (!result) {
      throw new Error(`Mock 数据不支持检查路径：${path}`);
    }

    return structuredClone(result);
  },
};
