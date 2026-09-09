import type { AgentToolResult } from "@earendil-works/pi-agent-core";

export type MachineEvidencePayload<TData, TTool extends string = string> = {
  evidenceType: "现场证据";
  tool: TTool;
  data: TData;
};

export type SopReferencePayload<TResult> = {
  evidenceType: "SOP 参考";
  authorization: false;
  found: boolean;
  query: string;
  results: TResult[];
};

export type EvidenceToolPayload<TMachineData, TSopResult> =
  | MachineEvidencePayload<TMachineData>
  | SopReferencePayload<TSopResult>;

export function createEvidenceToolResult<TPayload>(
  payload: TPayload,
): AgentToolResult<TPayload> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    details: payload,
  };
}
