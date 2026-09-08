import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
import type { DiskInspectionSource } from "../data-sources/disk-inspection-source.js";
import type { SopSource } from "../data-sources/sop-source.js";
import { createGetDiskUsageTool } from "../tools/inspect-disk.js";
import { createListLargeDirectoriesTool } from "../tools/inspect-directory.js";
import { createSearchSopTool } from "../tools/search-sop.js";
import { OPS_SYSTEM_PROMPT } from "./system-prompt.js";

type OpsAgentDependencies = {
  diskInspectionSource: DiskInspectionSource;
  sopSource: SopSource;
};

export function createOpsAgent({
  diskInspectionSource,
  sopSource,
}: OpsAgentDependencies): Agent {
  return new Agent({
    initialState: {
      systemPrompt: OPS_SYSTEM_PROMPT,
      model: getModel("deepseek", "deepseek-v4-flash"),
      thinkingLevel: "off",
      tools: [
        createSearchSopTool(sopSource),
        createGetDiskUsageTool(diskInspectionSource),
        createListLargeDirectoriesTool(diskInspectionSource),
      ],
    },
  });
}
