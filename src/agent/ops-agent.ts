import type { StreamFn } from "@earendil-works/pi-agent-core";
import { getModel, type Model } from "@earendil-works/pi-ai";
import type { DiskInspectionSource } from "../data-sources/disk-inspection-source.js";
import type { SopSource } from "../data-sources/sop-source.js";
import { createGetDiskUsageTool } from "../tools/inspect-disk.js";
import { createListLargeDirectoriesTool } from "../tools/inspect-directory.js";
import { createInspectFileTool } from "../tools/inspect-file.js";
import { createSearchSopTool } from "../tools/search-sop.js";
import { OPS_SYSTEM_PROMPT } from "./system-prompt.js";
import {
  OpsAgentRuntime,
  type OpsRuntimeLimits,
} from "./ops-agent-runtime.js";

type OpsAgentDependencies = {
  diskInspectionSource: DiskInspectionSource;
  sopSource: SopSource;
  model?: Model<any>;
  streamFn?: StreamFn;
  limits?: Partial<OpsRuntimeLimits>;
};

export function createOpsAgent({
  diskInspectionSource,
  sopSource,
  model = getModel("deepseek", "deepseek-v4-flash"),
  streamFn,
  limits,
}: OpsAgentDependencies): OpsAgentRuntime {
  return new OpsAgentRuntime({
    systemPrompt: OPS_SYSTEM_PROMPT,
    model,
    thinkingLevel: "off",
    streamFn,
    limits,
    tools: [
      createSearchSopTool(sopSource),
      createGetDiskUsageTool(diskInspectionSource),
      createListLargeDirectoriesTool(diskInspectionSource),
      createInspectFileTool(diskInspectionSource),
    ],
  });
}
