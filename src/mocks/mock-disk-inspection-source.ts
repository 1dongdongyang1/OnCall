import type {
  DirectoryUsage,
  DiskInspectionSource,
  DiskUsage,
  FileInspection,
} from "../data-sources/disk-inspection-source.js";

type MockNodeState = {
  diskUsage: DiskUsage;
  directoryUsage: Record<string, DirectoryUsage>;
  fileInspections: Record<string, FileInspection>;
};

const nodes: Record<string, MockNodeState> = {
  "node-01": {
    diskUsage: {
      node: "node-01",
      filesystems: [
        {
          mountPoint: "/",
          totalGb: 100,
          usedGb: 95,
          availableGb: 5,
          usagePercent: 95,
        },
      ],
    },
    directoryUsage: {
      "/": {
        node: "node-01",
        path: "/",
        entries: [
          { path: "/var", sizeGb: 72, kind: "directory", inspectable: true },
          { path: "/usr", sizeGb: 14, kind: "directory", inspectable: true },
          { path: "/home", sizeGb: 6, kind: "directory", inspectable: true },
        ],
      },
      "/var": {
        node: "node-01",
        path: "/var",
        entries: [
          { path: "/var/log", sizeGb: 65, kind: "directory", inspectable: true },
          { path: "/var/lib", sizeGb: 5, kind: "directory", inspectable: true },
          { path: "/var/cache", sizeGb: 2, kind: "directory", inspectable: true },
        ],
      },
      "/var/log": {
        node: "node-01",
        path: "/var/log",
        entries: [
          { path: "/var/log/app.log", sizeGb: 61, kind: "file", inspectable: true },
          { path: "/var/log/journal", sizeGb: 3, kind: "directory", inspectable: true },
          { path: "/var/log/syslog", sizeGb: 0.8, kind: "file", inspectable: true },
        ],
      },
    },
    fileInspections: {
      "/var/log/app.log": {
        node: "node-01",
        path: "/var/log/app.log",
        sizeGb: 61,
        owner: "app",
        modifiedAt: "2026-09-08T11:45:00+08:00",
        observations: [
          "文件仍在持续写入",
          "末尾日志重复出现 cache write retry 错误",
          "Mock 数据未提供日志轮转配置和业务影响信息",
        ],
      },
    },
  },
};

function getNodeState(node: string): MockNodeState {
  const state = nodes[node];

  if (!state) {
    throw new Error(`Mock 数据不支持节点：${node}`);
  }

  return state;
}

export const mockDiskInspectionSource: DiskInspectionSource = {
  getDiskUsage: async (node) => structuredClone(getNodeState(node).diskUsage),
  listLargeDirectories: async (node, path) => {
    const result = getNodeState(node).directoryUsage[path];

    if (!result) {
      throw new Error(`Mock 节点 ${node} 不支持检查路径：${path}`);
    }

    return structuredClone(result);
  },
  inspectFile: async (node, path) => {
    const result = getNodeState(node).fileInspections[path];

    if (!result) {
      throw new Error(`Mock 节点 ${node} 不支持检查文件：${path}`);
    }

    return structuredClone(result);
  },
};
