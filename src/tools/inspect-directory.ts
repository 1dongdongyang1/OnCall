import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type {
  DirectoryUsage,
  DiskInspectionSource,
} from "../data-sources/disk-inspection-source.js";

const parameters = Type.Object({
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
      "只读列出指定目录下占用最大的直接子目录，并按大小降序返回。",
    parameters,
    executionMode: "sequential",
    execute: async (_toolCallId, { path }) => {
      const result = await source.listLargeDirectories(path);

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
