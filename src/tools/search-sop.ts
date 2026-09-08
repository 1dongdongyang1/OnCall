import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { SopSource } from "../data-sources/sop-source.js";

const parameters = Type.Object({
  query: Type.String({
    description: "故障现象、错误码或需要查询的 SOP 关键词",
    minLength: 1,
  }),
});

export function createSearchSopTool(
  source: SopSource,
): AgentTool<typeof parameters, { sopId: string | null }> {
  return {
    name: "search_sop",
    label: "Search SOP",
    description:
      "从内部 SOP 知识库查询故障处理步骤。回答运维故障前必须先调用此工具。",
    parameters,
    executionMode: "sequential",
    execute: async (_toolCallId, { query }) => {
      const match = await source.findByQuery(query);

      if (!match) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ found: false, query }),
            },
          ],
          details: { sopId: null },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              found: true,
              id: match.id,
              title: match.title,
              steps: match.steps,
            }),
          },
        ],
        details: { sopId: match.id },
      };
    },
  };
}
