import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
import { searchSopTool } from "../tools/search-sop.js";
import { OPS_SYSTEM_PROMPT } from "./system-prompt.js";

export function createOpsAgent(): Agent {
  return new Agent({
    initialState: {
      systemPrompt: OPS_SYSTEM_PROMPT,
      model: getModel("deepseek", "deepseek-v4-flash"),
      thinkingLevel: "off",
      tools: [searchSopTool],
    },
  });
}
