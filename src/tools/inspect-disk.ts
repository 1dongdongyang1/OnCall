import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type {
  DiskInspectionSource,
  DiskUsage,
} from "../data-sources/disk-inspection-source.js";

const parameters = Type.Object({
  node: Type.String({
    description: "要检查的机器节点名称，例如 node-01",
    minLength: 1,
  }),
});

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
    execute: async (_toolCallId, { node }) => {
      const result = await source.getDiskUsage(node);

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
