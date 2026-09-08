import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type {
  DiskInspectionSource,
  DiskUsage,
} from "../data-sources/disk-inspection-source.js";

const parameters = Type.Object({});

export function createGetDiskUsageTool(
  source: DiskInspectionSource,
): AgentTool<typeof parameters, DiskUsage> {
  return {
    name: "get_disk_usage",
    label: "Get Disk Usage",
    description:
      "读取各文件系统的容量和使用率。收到磁盘容量告警时必须先调用此工具。",
    parameters,
    executionMode: "sequential",
    execute: async () => {
      const result = await source.getDiskUsage();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
        details: result,
      };
    },
  };
}
