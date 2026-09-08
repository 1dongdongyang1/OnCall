import type {
  DirectoryUsage,
  DiskInspectionSource,
  DiskUsage,
} from "../data-sources/disk-inspection-source.js";

type MockNodeState = {
  diskUsage: DiskUsage;
  directoryUsage: Record<string, DirectoryUsage>;
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
          { path: "/var", sizeGb: 72, inspectable: true },
          { path: "/usr", sizeGb: 14, inspectable: false },
          { path: "/home", sizeGb: 6, inspectable: false },
        ],
      },
      "/var": {
        node: "node-01",
        path: "/var",
        entries: [
          { path: "/var/log", sizeGb: 65, inspectable: false },
          { path: "/var/lib", sizeGb: 5, inspectable: false },
          { path: "/var/cache", sizeGb: 2, inspectable: false },
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
};
