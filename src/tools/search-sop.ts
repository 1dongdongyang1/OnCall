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
): AgentTool<
  typeof parameters,
  { documentIds: string[]; chunkIds: string[] }
> {
  return {
    name: "search_sop",
    label: "Search SOP",
    description:
      "根据故障关键词从内部 SOP 文档中查询处置依据。需要 SOP 步骤时调用此工具。",
    parameters,
    executionMode: "sequential",
    execute: async (_toolCallId, { query }) => {
      const matches = await source.search(query, 3);

      if (!matches.length) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ found: false, query }),
            },
          ],
          details: { documentIds: [], chunkIds: [] },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ found: true, results: matches }),
          },
        ],
        details: {
          documentIds: [...new Set(matches.map((match) => match.documentId))],
          chunkIds: matches.map((match) => match.chunkId),
        },
      };
    },
  };
}
