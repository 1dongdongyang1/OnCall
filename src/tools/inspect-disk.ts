import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type {
  DiskInspectionSource,
  DiskUsage,
} from "../data-sources/disk-inspection-source.js";
import {
  createEvidenceToolResult,
  type MachineEvidencePayload,
} from "./tool-result.js";

const parameters = Type.Object({
  node: Type.String({
    description: "要检查的机器节点名称，例如 node-01",
    minLength: 1,
  }),
});

export function createGetDiskUsageTool(
  source: DiskInspectionSource,
): AgentTool<
  typeof parameters,
  MachineEvidencePayload<DiskUsage, "get_disk_usage">
> {
  return {
    name: "get_disk_usage",
    label: "Get Disk Usage",
    description:
      "读取各文件系统的容量和使用率。收到磁盘容量告警时必须先调用此工具。",
    parameters,
    executionMode: "sequential",
    execute: async (toolCallId, { node }, signal) => {
      const result = await source.getDiskUsage(node, signal);
      return createEvidenceToolResult({
        evidenceType: "现场证据" as const,
        evidenceId: toolCallId,
        tool: "get_disk_usage" as const,
        data: result,
      });
    },
  };
}
