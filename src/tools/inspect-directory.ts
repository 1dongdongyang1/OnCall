import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type {
  DirectoryUsage,
  DiskInspectionSource,
} from "../data-sources/disk-inspection-source.js";

const parameters = Type.Object({
  node: Type.String({
    description: "要检查的机器节点名称，例如 node-01",
    minLength: 1,
  }),
  path: Type.String({
    description: "要检查的绝对目录路径，例如 / 或 /var",
    minLength: 1,
  }),
});

export function createListLargeDirectoriesTool(
  source: DiskInspectionSource,
): AgentTool<typeof parameters, DirectoryUsage> {
  return {
    name: "list_large_directories",
    label: "List Large Directories",
    description:
      "只读列出指定节点、指定目录下占用最大的直接子目录，并按大小降序返回。只有目标条目的 inspectable 为 true 时才能继续检查该路径；为 false 时必须停止下钻。",
    parameters,
    executionMode: "sequential",
    execute: async (_toolCallId, { node, path }) => {
      const result = await source.listLargeDirectories(node, path);

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
