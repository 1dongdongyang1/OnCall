import assert from "node:assert/strict";
import test from "node:test";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  registerFauxProvider,
} from "@earendil-works/pi-ai";
import type { SopSource } from "../data-sources/sop-source.js";
import { createMockDiskInspectionSource } from "../mocks/mock-disk-inspection-source.js";
import { createOpsAgent } from "./ops-agent.js";
import { diagnoseDiskAlert, parseDiskAlertInput } from "./disk-diagnosis.js";
import { DISK_DIAGNOSIS_EVAL_CASES } from "./disk-diagnosis-eval-cases.js";
import { evaluateDiskDiagnosis } from "./disk-diagnosis-evaluator.js";

const matchingSopSource: SopSource = {
  search: async (query) => [
    {
      chunkId: "chunk-disk-safe",
      documentId: "doc-disk",
      documentTitle: "磁盘使用率过高告警处理方案",
      sourcePath: "sops/disk_high_usage.md",
      headingPath: ["磁盘使用率过高告警处理方案", "常见原因分析"],
      content: "先确认现场使用率和主要占用；变更前需要业务确认、备份、审批和操作后验证。",
      contentHash: "hash-disk-safe",
      score: 1,
    },
  ],
};

const noMatchSopSource: SopSource = { search: async () => [] };

test("结构化磁盘告警输入拒绝无节点、相对挂载点和非法阈值", () => {
  assert.throws(
    () => parseDiskAlertInput({ kind: "disk_usage", alertId: "a", mountPoint: "/", thresholdPercent: 90, requestSopGuidance: true }),
    /node/,
  );
  assert.throws(
    () => parseDiskAlertInput({ kind: "disk_usage", alertId: "a", node: "n", mountPoint: "data", thresholdPercent: 90, requestSopGuidance: true }),
    /绝对路径/,
  );
  assert.throws(
    () => parseDiskAlertInput({ kind: "disk_usage", alertId: "a", node: "n", mountPoint: "/", thresholdPercent: 101, requestSopGuidance: true }),
    /0 到 100/,
  );
});

for (const evalCase of DISK_DIAGNOSIS_EVAL_CASES) {
  test(`确定性 Agent 业务评测：${evalCase.description}`, async () => {
    const registration = registerFauxProvider();
    const responses = evalCase.scriptedCalls.map((call) =>
      fauxAssistantMessage(
        fauxToolCall(call.name, call.args, { id: call.id }),
        { stopReason: "toolUse" },
      ),
    );
    if (evalCase.draft) {
      const finalText = evalCase.id === "active-alert"
        ? `已完成只读诊断。\n${JSON.stringify(evalCase.draft)}`
        : JSON.stringify(evalCase.draft);
      responses.push(fauxAssistantMessage(fauxText(finalText)));
    }
    registration.setResponses(responses);
    const agent = createOpsAgent({
      diskInspectionSource: createMockDiskInspectionSource(evalCase.scenarioId),
      sopSource: evalCase.sopMode === "match" ? matchingSopSource : noMatchSopSource,
      model: registration.getModel(),
      limits: {
        agentTimeoutMs: 2_000,
        modelRequestTimeoutMs: 1_000,
        toolTimeoutMs: 500,
        maxModelTurns: 8,
        maxToolCalls: 8,
      },
    });
    try {
      const outcome = await diagnoseDiskAlert(agent, evalCase.alert);
      const evaluation = evaluateDiskDiagnosis(evalCase, outcome);
      assert.equal(
        evaluation.passed,
        true,
        `${evalCase.id}: ${evaluation.failures.join("；")}`,
      );
    } finally {
      registration.unregister();
    }
  });
}

test("结构化报告拒绝没有现场证据支持的容量数值", async () => {
  const evalCase = DISK_DIAGNOSIS_EVAL_CASES.find(
    (item) => item.id === "active-alert",
  );
  assert.ok(evalCase?.draft);
  const registration = registerFauxProvider();
  registration.setResponses([
    ...evalCase.scriptedCalls.map((call) =>
      fauxAssistantMessage(
        fauxToolCall(call.name, call.args, { id: call.id }),
        { stopReason: "toolUse" },
      ),
    ),
    fauxAssistantMessage(
      fauxText(
        JSON.stringify({
          ...evalCase.draft,
          diagnosisConclusion: {
            ...evalCase.draft.diagnosisConclusion,
            summary: "根分区已用 91GB，告警仍生效。",
          },
        }),
      ),
    ),
  ]);
  const agent = createOpsAgent({
    diskInspectionSource: createMockDiskInspectionSource(evalCase.scenarioId),
    sopSource: matchingSopSource,
    model: registration.getModel(),
  });
  try {
    const outcome = await diagnoseDiskAlert(agent, evalCase.alert);
    assert.equal(outcome.report, undefined);
    assert.match(outcome.reportError ?? "", /没有现场数据支持的数值：91GB/);
  } finally {
    registration.unregister();
  }
});
