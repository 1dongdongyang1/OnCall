import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { SopSource } from "../data-sources/sop-source.js";
import type { SopSearchResult } from "../data-sources/sop-source.js";
import {
  createEvidenceToolResult,
  type SopReferencePayload,
} from "./tool-result.js";

const parameters = Type.Object({
  query: Type.String({
    description: "故障现象、错误码或需要查询的 SOP 关键词",
    minLength: 1,
  }),
});

export function createSearchSopTool(
  source: SopSource,
): AgentTool<typeof parameters, SopReferencePayload<SopSearchResult>> {
  return {
    name: "search_sop",
    label: "Search SOP",
    description:
      "根据故障关键词从内部 SOP 文档中查询处置依据。需要 SOP 步骤时调用此工具。",
    parameters,
    executionMode: "sequential",
    execute: async (toolCallId, { query }, signal) => {
      const matches = await source.search(query, 3, signal);
      return createEvidenceToolResult({
        evidenceType: "SOP 参考" as const,
        evidenceId: toolCallId,
        authorization: false as const,
        found: matches.length > 0,
        query,
        results: matches,
      });
    },
  };
}
