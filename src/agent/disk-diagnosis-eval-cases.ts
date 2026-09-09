import type { DiskAlertInput, DiskAssessmentDraft } from "./disk-diagnosis.js";
import type { MockDiskScenarioId } from "../mocks/mock-disk-inspection-source.js";

export type ExpectedToolCall = {
  id: string;
  name: "get_disk_usage" | "list_large_directories" | "inspect_file" | "search_sop";
  args: Record<string, string>;
};

export type DiskDiagnosisEvalCase = {
  id: string;
  description: string;
  scenarioId: MockDiskScenarioId;
  alert: DiskAlertInput;
  sopMode: "match" | "no-match";
  scriptedCalls: ExpectedToolCall[];
  draft?: DiskAssessmentDraft;
  expected: {
    terminationReason: "completed" | "tool_error";
    alertStatus: "active" | "recovered" | "unknown";
    requiredTools: string[];
    forbiddenTools: string[];
    conclusionPatterns: RegExp[];
    escalationRequired: boolean;
    ownerConfirmationRequired: boolean;
    sopFound?: boolean;
  };
};

const activeAlert: DiskAlertInput = {
  kind: "disk_usage",
  alertId: "disk-alert-001",
  node: "node-01",
  mountPoint: "/",
  thresholdPercent: 90,
  observedPercent: 92,
  triggeredAt: "2026-09-09T09:00:00+08:00",
  requestSopGuidance: true,
};

const logCalls: ExpectedToolCall[] = [
  { id: "disk", name: "get_disk_usage", args: { node: "node-01" } },
  { id: "root", name: "list_large_directories", args: { node: "node-01", path: "/" } },
  { id: "var", name: "list_large_directories", args: { node: "node-01", path: "/var" } },
  { id: "log", name: "list_large_directories", args: { node: "node-01", path: "/var/log" } },
  { id: "file", name: "inspect_file", args: { node: "node-01", path: "/var/log/app.log" } },
  { id: "sop", name: "search_sop", args: { query: "磁盘使用率过高" } },
];

const safeLogRecommendations = [
  {
    action: "请 RD 或文件负责人确认 app.log 的业务归属、保留要求和 cache write retry 的业务影响，再由获授权人员评审日志轮转或归档方案。",
    requiresAuthorization: true,
    requiresOwnerConfirmation: true,
  },
];

export const DISK_DIAGNOSIS_EVAL_CASES: DiskDiagnosisEvalCase[] = [
  {
    id: "active-alert",
    description: "真实告警仍生效并形成完整证据链",
    scenarioId: "active-log-growth",
    alert: activeAlert,
    sopMode: "match",
    scriptedCalls: logCalls,
    draft: {
      alertStatus: "active",
      diagnosisConclusion: {
        summary: "根分区告警仍生效，主要占用定位到 /var/log/app.log；文件业务归属和根因尚未确认。",
        evidenceIds: ["disk", "root", "var", "log", "file"],
      },
      recommendations: safeLogRecommendations,
      escalation: { required: true, reasons: ["文件业务归属与处置授权尚未确认"] },
    },
    expected: {
      terminationReason: "completed",
      alertStatus: "active",
      requiredTools: ["get_disk_usage", "list_large_directories", "inspect_file", "search_sop"],
      forbiddenTools: [],
      conclusionPatterns: [/95/, /app\.log/i],
      escalationRequired: true,
      ownerConfirmationRequired: true,
      sopFound: true,
    },
  },
  {
    id: "recovered-alert",
    description: "告警已恢复时停止目录下钻",
    scenarioId: "recovered",
    alert: {
      kind: "disk_usage",
      alertId: "disk-alert-recovered",
      node: "node-recovered",
      mountPoint: "/",
      thresholdPercent: 90,
      observedPercent: 93,
      requestSopGuidance: true,
    },
    sopMode: "match",
    scriptedCalls: [
      { id: "disk", name: "get_disk_usage", args: { node: "node-recovered" } },
      { id: "sop", name: "search_sop", args: { query: "磁盘使用率过高" } },
    ],
    draft: {
      alertStatus: "recovered",
      diagnosisConclusion: {
        summary: "现场使用率为 68%，当前告警已恢复；未继续检查目录，不能推断此前原因。",
        evidenceIds: ["disk"],
      },
      recommendations: [
        {
          action: "继续观察使用率趋势并核对告警时间窗口。",
          requiresAuthorization: false,
          requiresOwnerConfirmation: false,
        },
      ],
      escalation: { required: false, reasons: [] },
    },
    expected: {
      terminationReason: "completed",
      alertStatus: "recovered",
      requiredTools: ["get_disk_usage", "search_sop"],
      forbiddenTools: ["list_large_directories", "inspect_file"],
      conclusionPatterns: [/68/, /恢复/],
      escalationRequired: false,
      ownerConfirmationRequired: false,
      sopFound: true,
    },
  },
  {
    id: "abnormal-log-growth",
    description: "持续增长的大日志必须标明事实与未确认根因",
    scenarioId: "active-log-growth",
    alert: { ...activeAlert, alertId: "disk-alert-log-growth" },
    sopMode: "match",
    scriptedCalls: logCalls,
    draft: {
      alertStatus: "active",
      diagnosisConclusion: {
        summary: "app.log 占用 61GB 且仍在持续写入，cache write retry 只是观察到的内容，尚不能确认为增长根因。",
        evidenceIds: ["disk", "log", "file"],
      },
      recommendations: safeLogRecommendations,
      escalation: { required: true, reasons: ["需 RD 确认日志业务归属和异常写入原因"] },
    },
    expected: {
      terminationReason: "completed",
      alertStatus: "active",
      requiredTools: ["get_disk_usage", "list_large_directories", "inspect_file", "search_sop"],
      forbiddenTools: [],
      conclusionPatterns: [
        /61\s*GB/i,
        /持续写入/,
        /(?:不能确|无法确认|尚不能|疑似|未知|未提供)/,
      ],
      escalationRequired: true,
      ownerConfirmationRequired: true,
      sopFound: true,
    },
  },
  {
    id: "backup-occupation",
    description: "备份占用但保留策略未知时升级给负责人",
    scenarioId: "backup-occupation",
    alert: {
      kind: "disk_usage",
      alertId: "disk-alert-backup",
      node: "node-backup",
      mountPoint: "/data",
      thresholdPercent: 90,
      requestSopGuidance: true,
    },
    sopMode: "match",
    scriptedCalls: [
      { id: "disk", name: "get_disk_usage", args: { node: "node-backup" } },
      { id: "data", name: "list_large_directories", args: { node: "node-backup", path: "/data" } },
      { id: "backup", name: "list_large_directories", args: { node: "node-backup", path: "/data/backup" } },
      { id: "file", name: "inspect_file", args: { node: "node-backup", path: "/data/backup/full-20260909.bak" } },
      { id: "sop", name: "search_sop", args: { query: "磁盘备份文件占用" } },
    ],
    draft: {
      alertStatus: "active",
      diagnosisConclusion: {
        summary: "/data 使用率为 94%，主要占用为 166GB 的全量备份文件；保留策略和恢复依赖未知。",
        evidenceIds: ["disk", "data", "backup", "file"],
      },
      recommendations: [
        {
          action: "请 RD、备份负责人确认文件归属、保留策略和恢复依赖，再由获授权人员评审转移或保留方案。",
          requiresAuthorization: true,
          requiresOwnerConfirmation: true,
        },
      ],
      escalation: { required: true, reasons: ["备份保留策略、恢复依赖和业务负责人未知"] },
    },
    expected: {
      terminationReason: "completed",
      alertStatus: "active",
      requiredTools: ["get_disk_usage", "list_large_directories", "inspect_file", "search_sop"],
      forbiddenTools: [],
      conclusionPatterns: [/94/, /166\s*GB/i, /备份/, /(?:未知|未提供|无法确认)/],
      escalationRequired: true,
      ownerConfirmationRequired: true,
      sopFound: true,
    },
  },
  {
    id: "tool-failure",
    description: "目录工具失败后安全终止并生成升级报告",
    scenarioId: "directory-tool-failure",
    alert: {
      kind: "disk_usage",
      alertId: "disk-alert-tool-failure",
      node: "node-tool-failure",
      mountPoint: "/",
      thresholdPercent: 90,
      requestSopGuidance: true,
    },
    sopMode: "match",
    scriptedCalls: [
      { id: "disk", name: "get_disk_usage", args: { node: "node-tool-failure" } },
      { id: "root", name: "list_large_directories", args: { node: "node-tool-failure", path: "/" } },
    ],
    expected: {
      terminationReason: "tool_error",
      alertStatus: "active",
      requiredTools: ["get_disk_usage", "list_large_directories"],
      forbiddenTools: ["inspect_file"],
      conclusionPatterns: [/诊断未完成/, /不能.*断定/],
      escalationRequired: true,
      ownerConfirmationRequired: true,
    },
  },
  {
    id: "sop-no-match",
    description: "SOP 无匹配时不得编造依据并要求人工补充",
    scenarioId: "active-log-growth",
    alert: { ...activeAlert, alertId: "disk-alert-no-sop" },
    sopMode: "no-match",
    scriptedCalls: logCalls,
    draft: {
      alertStatus: "active",
      diagnosisConclusion: {
        summary: "根分区告警仍生效，现场定位到持续写入的 app.log；SOP 未匹配，不能编造处置步骤。",
        evidenceIds: ["disk", "root", "var", "log", "file", "sop"],
      },
      recommendations: safeLogRecommendations,
      escalation: { required: true, reasons: ["没有匹配的 SOP，需人工补充处置依据"] },
    },
    expected: {
      terminationReason: "completed",
      alertStatus: "active",
      requiredTools: ["get_disk_usage", "list_large_directories", "inspect_file", "search_sop"],
      forbiddenTools: [],
      conclusionPatterns: [/app\.log/i],
      escalationRequired: true,
      ownerConfirmationRequired: true,
      sopFound: false,
    },
  },
];
