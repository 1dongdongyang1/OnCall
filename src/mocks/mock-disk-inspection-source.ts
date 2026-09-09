import type {
  DirectoryUsage,
  DiskInspectionSource,
  DiskUsage,
  FileInspection,
} from "../data-sources/disk-inspection-source.js";

export type MockDiskScenarioId =
  | "active-log-growth"
  | "recovered"
  | "backup-occupation"
  | "directory-tool-failure";

type MockNodeState = {
  diskUsage: DiskUsage;
  directoryUsage: Record<string, DirectoryUsage>;
  fileInspections: Record<string, FileInspection>;
  failingDirectoryPath?: string;
};

const scenarios: Record<MockDiskScenarioId, MockNodeState> = {
  "active-log-growth": {
    diskUsage: {
      node: "node-01",
      filesystems: [
        { mountPoint: "/", totalGb: 100, usedGb: 95, availableGb: 5, usagePercent: 95 },
      ],
    },
    directoryUsage: {
      "/": {
        node: "node-01",
        path: "/",
        entries: [
          { path: "/var", sizeGb: 72, kind: "directory", inspectable: true },
          { path: "/usr", sizeGb: 14, kind: "directory", inspectable: false },
          { path: "/home", sizeGb: 6, kind: "directory", inspectable: false },
        ],
      },
      "/var": {
        node: "node-01",
        path: "/var",
        entries: [
          { path: "/var/log", sizeGb: 65, kind: "directory", inspectable: true },
          { path: "/var/lib", sizeGb: 5, kind: "directory", inspectable: false },
          { path: "/var/cache", sizeGb: 2, kind: "directory", inspectable: false },
        ],
      },
      "/var/log": {
        node: "node-01",
        path: "/var/log",
        entries: [
          { path: "/var/log/app.log", sizeGb: 61, kind: "file", inspectable: true },
          { path: "/var/log/journal", sizeGb: 3, kind: "directory", inspectable: false },
          { path: "/var/log/syslog", sizeGb: 0.8, kind: "file", inspectable: false },
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
          "Mock 数据未提供日志轮转配置、文件业务归属和业务影响信息",
        ],
      },
    },
  },
  recovered: {
    diskUsage: {
      node: "node-recovered",
      filesystems: [
        { mountPoint: "/", totalGb: 100, usedGb: 68, availableGb: 32, usagePercent: 68 },
      ],
    },
    directoryUsage: {},
    fileInspections: {},
  },
  "backup-occupation": {
    diskUsage: {
      node: "node-backup",
      filesystems: [
        { mountPoint: "/data", totalGb: 200, usedGb: 188, availableGb: 12, usagePercent: 94 },
      ],
    },
    directoryUsage: {
      "/data": {
        node: "node-backup",
        path: "/data",
        entries: [
          { path: "/data/backup", sizeGb: 171, kind: "directory", inspectable: true },
          { path: "/data/app", sizeGb: 12, kind: "directory", inspectable: false },
        ],
      },
      "/data/backup": {
        node: "node-backup",
        path: "/data/backup",
        entries: [
          { path: "/data/backup/full-20260909.bak", sizeGb: 166, kind: "file", inspectable: true },
        ],
      },
    },
    fileInspections: {
      "/data/backup/full-20260909.bak": {
        node: "node-backup",
        path: "/data/backup/full-20260909.bak",
        sizeGb: 166,
        owner: "backup-service",
        modifiedAt: "2026-09-09T02:10:00+08:00",
        observations: [
          "文件名和目录表明它是全量备份产物",
          "Mock 数据未提供备份保留策略、恢复依赖和业务负责人",
        ],
      },
    },
  },
  "directory-tool-failure": {
    diskUsage: {
      node: "node-tool-failure",
      filesystems: [
        { mountPoint: "/", totalGb: 100, usedGb: 96, availableGb: 4, usagePercent: 96 },
      ],
    },
    directoryUsage: {},
    fileInspections: {},
    failingDirectoryPath: "/",
  },
};

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

export function createMockDiskInspectionSource(
  scenarioId: MockDiskScenarioId,
): DiskInspectionSource {
  const state = scenarios[scenarioId];
  const expectedNode = state.diskUsage.node;
  const assertNode = (node: string): void => {
    if (node !== expectedNode) {
      throw new Error(`Mock 数据不支持节点：${node}（场景 ${scenarioId}）`);
    }
  };
  return {
    getDiskUsage: async (node, signal) => {
      throwIfAborted(signal);
      assertNode(node);
      return structuredClone(state.diskUsage);
    },
    listLargeDirectories: async (node, path, signal) => {
      throwIfAborted(signal);
      assertNode(node);
      if (state.failingDirectoryPath === path) {
        throw new Error(`Mock 目录检查失败：${path}`);
      }
      const result = state.directoryUsage[path];
      if (!result) {
        throw new Error(`Mock 节点 ${node} 不支持检查路径：${path}`);
      }
      return structuredClone(result);
    },
    inspectFile: async (node, path, signal) => {
      throwIfAborted(signal);
      assertNode(node);
      const result = state.fileInspections[path];
      if (!result) {
        throw new Error(`Mock 节点 ${node} 不支持检查文件：${path}`);
      }
      return structuredClone(result);
    },
  };
}

export const mockDiskInspectionSource = createMockDiskInspectionSource(
  "active-log-growth",
);
