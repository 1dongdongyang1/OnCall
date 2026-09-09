import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { OpsAgentRuntime, OpsRunResult } from "./ops-agent-runtime.js";
import type {
  MachineEvidencePayload,
  SopReferencePayload,
} from "../tools/tool-result.js";
import type { SopSearchResult } from "../data-sources/sop-source.js";

export type DiskAlertInput = {
  kind: "disk_usage";
  alertId: string;
  node: string;
  mountPoint: string;
  thresholdPercent: number;
  observedPercent?: number;
  triggeredAt?: string;
  requestSopGuidance: boolean;
};

export type DiskAlertStatus = "active" | "recovered" | "unknown";

export type DiskAssessmentDraft = {
  alertStatus: DiskAlertStatus;
  diagnosisConclusion: {
    summary: string;
    evidenceIds: string[];
  };
  recommendations: Array<{
    action: string;
    requiresAuthorization: boolean;
    requiresOwnerConfirmation: boolean;
  }>;
  escalation: {
    required: boolean;
    reasons: string[];
  };
};

export type DiskDiagnosticReport = DiskAssessmentDraft & {
  alert: DiskAlertInput;
  onsiteEvidence: Array<{
    evidenceId: string;
    tool: string;
    data: unknown;
  }>;
  sopReferences: Array<{
    evidenceId: string;
    authorization: false;
    found: boolean;
    query: string;
    results: Array<
      Pick<
        SopSearchResult,
        | "chunkId"
        | "documentId"
        | "documentTitle"
        | "sourcePath"
        | "headingPath"
        | "score"
      >
    >;
  }>;
  checksPerformed: Array<{
    tool: string;
    args: unknown;
    evidenceId?: string;
    outcome: "succeeded" | "failed";
  }>;
};

export type DiskDiagnosisOutcome = {
  run: OpsRunResult;
  report?: DiskDiagnosticReport;
  reportError?: string;
};

type ToolTrace = {
  toolCallId: string;
  tool: string;
  args: unknown;
  isError?: boolean;
  payload?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} 必须是非空字符串`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} 必须是布尔值`);
  }
  return value;
}

export function parseDiskAlertInput(input: string | unknown): DiskAlertInput {
  const value = typeof input === "string" ? JSON.parse(input) : input;
  if (!isRecord(value)) {
    throw new Error("磁盘告警输入必须是 JSON 对象");
  }
  if (value.kind !== "disk_usage") {
    throw new Error("kind 必须是 disk_usage");
  }
  const thresholdPercent = value.thresholdPercent;
  if (
    typeof thresholdPercent !== "number" ||
    !Number.isFinite(thresholdPercent) ||
    thresholdPercent <= 0 ||
    thresholdPercent > 100
  ) {
    throw new Error("thresholdPercent 必须是 0 到 100 之间的数字");
  }
  if (
    value.observedPercent !== undefined &&
    (typeof value.observedPercent !== "number" ||
      !Number.isFinite(value.observedPercent) ||
      value.observedPercent < 0 ||
      value.observedPercent > 100)
  ) {
    throw new Error("observedPercent 必须是 0 到 100 之间的数字");
  }
  const mountPoint = requireString(value.mountPoint, "mountPoint");
  if (!mountPoint.startsWith("/")) {
    throw new Error("mountPoint 必须是绝对路径");
  }
  return {
    kind: "disk_usage",
    alertId: requireString(value.alertId, "alertId"),
    node: requireString(value.node, "node"),
    mountPoint,
    thresholdPercent,
    ...(value.observedPercent === undefined
      ? {}
      : { observedPercent: value.observedPercent as number }),
    ...(value.triggeredAt === undefined
      ? {}
      : { triggeredAt: requireString(value.triggeredAt, "triggeredAt") }),
    requestSopGuidance: requireBoolean(
      value.requestSopGuidance,
      "requestSopGuidance",
    ),
  };
}

export function createDiskDiagnosisPrompt(alert: DiskAlertInput): string {
  return [
    "处理下面的结构化磁盘使用率告警。只允许只读检查。",
    JSON.stringify(alert),
    "必须先调用 get_disk_usage 现场确认告警状态。若已恢复，不再下钻目录。",
    "若告警仍生效，沿返回的 inspectable 条目定位主要占用，并在发现具体文件后调用 inspect_file 分析文件性质。",
    alert.requestSopGuidance
      ? "必须调用一次 search_sop 获取参考依据。"
      : "除非诊断确有必要，否则不要求查询 SOP。",
    "最终只输出一个 JSON 对象，不要使用 Markdown 代码块。JSON 结构必须为：",
    JSON.stringify({
      alertStatus: "active | recovered | unknown",
      diagnosisConclusion: {
        summary: "有依据的结论；未知内容必须明确写未知",
        evidenceIds: ["只能填写工具结果中的 evidenceId"],
      },
      recommendations: [
        {
          action: "不包含具体删除、清空、截断、重启或扩容命令的安全建议",
          requiresAuthorization: true,
          requiresOwnerConfirmation: true,
        },
      ],
      escalation: { required: true, reasons: ["升级原因"] },
    }),
    "不能编造 evidenceId。SOP 不是执行授权。无法确认文件业务归属时，必须建议 RD/文件负责人确认并设置 requiresOwnerConfirmation=true。",
  ].join("\n");
}

function parseAssistantJson(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch (wholeTextError) {
    let firstObject: unknown;
    for (let start = 0; start < unfenced.length; start += 1) {
      if (unfenced[start] !== "{") {
        continue;
      }
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let end = start; end < unfenced.length; end += 1) {
        const character = unfenced[end];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (character === "\\") {
            escaped = true;
          } else if (character === '"') {
            inString = false;
          }
          continue;
        }
        if (character === '"') {
          inString = true;
        } else if (character === "{") {
          depth += 1;
        } else if (character === "}") {
          depth -= 1;
          if (depth === 0) {
            try {
              const candidate = JSON.parse(unfenced.slice(start, end + 1));
              firstObject ??= candidate;
              if (
                isRecord(candidate) &&
                candidate.alertStatus !== undefined &&
                candidate.diagnosisConclusion !== undefined
              ) {
                return candidate;
              }
              start = end;
              break;
            } catch {
              break;
            }
          }
        }
      }
    }
    if (firstObject !== undefined) {
      return firstObject;
    }
    throw wholeTextError;
  }
}

function parseDraft(text: string): DiskAssessmentDraft {
  const value = parseAssistantJson(text);
  if (!isRecord(value) || !isRecord(value.diagnosisConclusion)) {
    throw new Error("模型输出不是有效的结构化诊断对象");
  }
  if (!isRecord(value.escalation) || !Array.isArray(value.recommendations)) {
    throw new Error("模型输出缺少 recommendations 或 escalation");
  }
  const alertStatus = value.alertStatus;
  if (alertStatus !== "active" && alertStatus !== "recovered" && alertStatus !== "unknown") {
    throw new Error("alertStatus 必须是 active、recovered 或 unknown");
  }
  const evidenceIds = value.diagnosisConclusion.evidenceIds;
  if (!Array.isArray(evidenceIds) || evidenceIds.some((item) => typeof item !== "string")) {
    throw new Error("diagnosisConclusion.evidenceIds 必须是字符串数组");
  }
  const recommendations = value.recommendations.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`recommendations[${index}] 必须是对象`);
    }
    return {
      action: requireString(item.action, `recommendations[${index}].action`),
      requiresAuthorization: requireBoolean(
        item.requiresAuthorization,
        `recommendations[${index}].requiresAuthorization`,
      ),
      requiresOwnerConfirmation: requireBoolean(
        item.requiresOwnerConfirmation,
        `recommendations[${index}].requiresOwnerConfirmation`,
      ),
    };
  });
  const reasons = value.escalation.reasons;
  if (!Array.isArray(reasons) || reasons.some((item) => typeof item !== "string")) {
    throw new Error("escalation.reasons 必须是字符串数组");
  }
  return {
    alertStatus,
    diagnosisConclusion: {
      summary: requireString(value.diagnosisConclusion.summary, "diagnosisConclusion.summary"),
      evidenceIds,
    },
    recommendations,
    escalation: {
      required: requireBoolean(value.escalation.required, "escalation.required"),
      reasons,
    },
  };
}

function assistantText(agent: OpsAgentRuntime): string {
  const message = [...agent.state.messages]
    .reverse()
    .find((item): item is AssistantMessage => item.role === "assistant");
  if (!message) {
    throw new Error("Agent 未返回最终回答");
  }
  return message.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("");
}

function payloadFromResult(result: unknown): unknown {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return undefined;
  }
  const text = result.content.find(
    (item) => isRecord(item) && item.type === "text" && typeof item.text === "string",
  );
  if (!isRecord(text) || typeof text.text !== "string") {
    return undefined;
  }
  return JSON.parse(text.text);
}

function collectTrace(agent: OpsAgentRuntime): { trace: ToolTrace[]; unsubscribe: () => void } {
  const trace: ToolTrace[] = [];
  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    if (event.type === "tool_execution_start") {
      trace.push({
        toolCallId: event.toolCallId,
        tool: event.toolName,
        args: event.args,
      });
    }
    if (event.type === "tool_execution_end") {
      const entry = trace.find((item) => item.toolCallId === event.toolCallId);
      if (entry) {
        entry.isError = event.isError;
        entry.payload = payloadFromResult(event.result);
      }
    }
  });
  return { trace, unsubscribe };
}

function isMachineEvidence(
  value: unknown,
): value is MachineEvidencePayload<unknown> {
  return isRecord(value) && value.evidenceType === "现场证据";
}

function isSopReference(
  value: unknown,
): value is SopReferencePayload<SopSearchResult> {
  return (
    isRecord(value) &&
    value.evidenceType === "SOP 参考" &&
    value.authorization === false
  );
}

function collectNumbers(value: unknown, numbers: Set<number>): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    numbers.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectNumbers(item, numbers));
    return;
  }
  if (isRecord(value)) {
    Object.values(value).forEach((item) => collectNumbers(item, numbers));
  }
}

function validateGroundedQuantities(
  draft: DiskAssessmentDraft,
  alert: DiskAlertInput,
  machineEvidence: ToolTrace[],
): void {
  const directNumbers = new Set<number>();
  collectNumbers(alert, directNumbers);
  machineEvidence.forEach((item) => {
    if (isMachineEvidence(item.payload)) {
      collectNumbers(item.payload.data, directNumbers);
    }
  });
  const derivedPercentages = new Set<number>();
  const direct = [...directNumbers].filter((number) => number > 0);
  for (const numerator of direct) {
    for (const denominator of direct) {
      if (numerator <= denominator) {
        derivedPercentages.add(Math.round((numerator / denominator) * 100));
      }
    }
  }
  const narrative = [
    draft.diagnosisConclusion.summary,
    ...draft.recommendations.map((item) => item.action),
    ...draft.escalation.reasons,
  ].join("\n");
  const quantities = narrative.matchAll(
    /(?<![\d-])(\d+(?:\.\d+)?)\s*(GB|GiB|G|%)/gi,
  );
  for (const match of quantities) {
    const number = Number(match[1]);
    const isPercentage = match[2] === "%";
    if (
      !directNumbers.has(number) &&
      !(isPercentage && derivedPercentages.has(number))
    ) {
      throw new Error(`报告包含没有现场数据支持的数值：${match[0]}`);
    }
  }
}

export function buildDiskDiagnosticReport(
  alert: DiskAlertInput,
  draft: DiskAssessmentDraft,
  trace: ToolTrace[],
): DiskDiagnosticReport {
  const successful = trace.filter((item) => item.isError === false);
  const machineEvidence = successful.filter((item) => isMachineEvidence(item.payload));
  const sopEvidence = successful.filter((item) => isSopReference(item.payload));
  const evidenceIds = new Set(successful.map((item) => item.toolCallId));
  for (const evidenceId of draft.diagnosisConclusion.evidenceIds) {
    if (!evidenceIds.has(evidenceId)) {
      throw new Error(`诊断结论引用了不存在或失败的证据：${evidenceId}`);
    }
  }
  const crossNode = trace.find((item) => {
    if (item.tool === "search_sop" || !isRecord(item.args)) {
      return false;
    }
    return item.args.node !== alert.node;
  });
  if (crossNode) {
    throw new Error(`机器检查越过告警节点边界：${crossNode.tool}`);
  }
  const diskEvidence = machineEvidence.find(
    (item) =>
      isMachineEvidence(item.payload) && item.payload.tool === "get_disk_usage",
  );
  const diskData = diskEvidence && isMachineEvidence(diskEvidence.payload)
    ? diskEvidence.payload.data
    : undefined;
  let expectedStatus: DiskAlertStatus = "unknown";
  if (isRecord(diskData) && Array.isArray(diskData.filesystems)) {
    const filesystem = diskData.filesystems.find(
      (item) => isRecord(item) && item.mountPoint === alert.mountPoint,
    );
    if (isRecord(filesystem) && typeof filesystem.usagePercent === "number") {
      expectedStatus = filesystem.usagePercent >= alert.thresholdPercent
        ? "active"
        : "recovered";
    }
  }
  if (draft.alertStatus !== expectedStatus) {
    throw new Error(
      `告警状态与现场磁盘证据不一致：期望 ${expectedStatus}，实际 ${draft.alertStatus}`,
    );
  }
  if (expectedStatus === "recovered" && trace.some((item) => item.tool === "list_large_directories" || item.tool === "inspect_file")) {
    throw new Error("告警已恢复时不应继续下钻目录或文件");
  }
  validateGroundedQuantities(draft, alert, machineEvidence);
  const machineEvidenceText = JSON.stringify(
    machineEvidence.map((item) => item.payload),
  );
  if (
    /(?:(?:业务归属|业务负责人).{0,24}(?:未提供|未知)|未提供.{0,24}(?:业务归属|业务负责人))/.test(machineEvidenceText) &&
    !draft.recommendations.some(
      (item) =>
        item.requiresOwnerConfirmation && /RD|负责人|归属/.test(item.action),
    )
  ) {
    throw new Error("文件业务归属未知时必须建议 RD 或文件负责人确认");
  }
  const dangerousCommand = draft.recommendations.find((item) =>
    /(?:\brm\b|\btruncate\b|\breboot\b|\brestart\b|\bdelete\b|>\s*\/|systemctl|docker\s+.*prune|find\s+.*-delete)/i.test(item.action),
  );
  if (dangerousCommand) {
    throw new Error(`处置建议包含禁止直接提供的变更命令：${dangerousCommand.action}`);
  }
  return {
    alert,
    ...draft,
    onsiteEvidence: machineEvidence.map((item) => {
      const payload = item.payload as MachineEvidencePayload<unknown>;
      return {
        evidenceId: item.toolCallId,
        tool: payload.tool,
        data: payload.data,
      };
    }),
    sopReferences: sopEvidence.map((item) => {
      const payload = item.payload as SopReferencePayload<SopSearchResult>;
      return {
        evidenceId: item.toolCallId,
        authorization: false,
        found: payload.found,
        query: payload.query,
        results: payload.results.map((result) => ({
          chunkId: result.chunkId,
          documentId: result.documentId,
          documentTitle: result.documentTitle,
          sourcePath: result.sourcePath,
          headingPath: result.headingPath,
          score: result.score,
        })),
      };
    }),
    checksPerformed: trace.map((item) => ({
      tool: item.tool,
      args: item.args,
      ...(item.isError === false ? { evidenceId: item.toolCallId } : {}),
      outcome: item.isError === false ? "succeeded" : "failed",
    })),
  };
}

export async function diagnoseDiskAlert(
  agent: OpsAgentRuntime,
  input: DiskAlertInput | unknown,
): Promise<DiskDiagnosisOutcome> {
  const alert = parseDiskAlertInput(input);
  const { trace, unsubscribe } = collectTrace(agent);
  try {
    const run = await agent.prompt(createDiskDiagnosisPrompt(alert));
    if (run.terminationReason !== "completed") {
      const successfulEvidenceIds = trace
        .filter((item) => item.isError === false)
        .map((item) => item.toolCallId);
      const diskEvidence = trace.find(
        (item) =>
          item.isError === false &&
          isMachineEvidence(item.payload) &&
          item.payload.tool === "get_disk_usage",
      );
      let alertStatus: DiskAlertStatus = "unknown";
      if (
        diskEvidence &&
        isMachineEvidence(diskEvidence.payload) &&
        isRecord(diskEvidence.payload.data) &&
        Array.isArray(diskEvidence.payload.data.filesystems)
      ) {
        const filesystem = diskEvidence.payload.data.filesystems.find(
          (item) => isRecord(item) && item.mountPoint === alert.mountPoint,
        );
        if (isRecord(filesystem) && typeof filesystem.usagePercent === "number") {
          alertStatus = filesystem.usagePercent >= alert.thresholdPercent
            ? "active"
            : "recovered";
        }
      }
      const fallback: DiskAssessmentDraft = {
        alertStatus,
        diagnosisConclusion: {
          summary: `诊断未完成：${run.terminationMessage}。不能在缺少后续证据时断定占用来源或根因。`,
          evidenceIds: successfulEvidenceIds,
        },
        recommendations: [
          {
            action: "由人工在同一节点补充失败的只读检查，确认文件业务归属后再评审处置方案。",
            requiresAuthorization: false,
            requiresOwnerConfirmation: true,
          },
        ],
        escalation: {
          required: true,
          reasons: [`自动诊断因 ${run.terminationReason} 安全终止，需要人工接管`],
        },
      };
      return {
        run,
        report: buildDiskDiagnosticReport(alert, fallback, trace),
      };
    }
    try {
      const draft = parseDraft(assistantText(agent));
      return { run, report: buildDiskDiagnosticReport(alert, draft, trace) };
    } catch (error) {
      return {
        run,
        reportError: error instanceof Error ? error.message : String(error),
      };
    }
  } finally {
    unsubscribe();
  }
}
