import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type {
  DiskInspectionSource,
  FileInspection,
} from "../data-sources/disk-inspection-source.js";

const parameters = Type.Object({
  node: Type.String({
    description: "要检查的机器节点名称，例如 node-01",
    minLength: 1,
  }),
  path: Type.String({
    description: "要只读检查的绝对文件路径，例如 /var/log/app.log",
    minLength: 1,
  }),
});

export function createInspectFileTool(
  source: DiskInspectionSource,
): AgentTool<typeof parameters, FileInspection> {
  return {
    name: "inspect_file",
    label: "Inspect File",
    description:
      "只读检查已由目录扫描定位出的具体文件，返回大小、属主、修改时间和有限观察结果；不得用它猜测或扫描未知路径。",
    parameters,
    executionMode: "sequential",
    execute: async (_toolCallId, { node, path }) => {
      const result = await source.inspectFile(node, path);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              evidenceType: "现场证据",
              tool: "inspect_file",
              data: result,
            }),
          },
        ],
        details: result,
      };
    },
  };
}
