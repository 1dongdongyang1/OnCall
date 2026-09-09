import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import test from "node:test";
import type { SopSource } from "../data-sources/sop-source.js";
import { createMockDiskInspectionSource } from "../mocks/mock-disk-inspection-source.js";
import { buildChunkStore } from "../rag/chunk-store.js";
import {
  buildLocalTfidfIndex,
  LocalTfidfSopSource,
} from "../rag/local-tfidf-index.js";
import { diagnoseDiskAlert } from "./disk-diagnosis.js";
import { DISK_DIAGNOSIS_EVAL_CASES } from "./disk-diagnosis-eval-cases.js";
import { evaluateDiskDiagnosis } from "./disk-diagnosis-evaluator.js";
import { createOpsAgent } from "./ops-agent.js";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

assert.ok(
  process.env.DEEPSEEK_API_KEY,
  "Agent 集成测试需要在 .env 中配置 DEEPSEEK_API_KEY",
);

const tfidfIndexPath = resolve(".rag-index", "sop-tfidf-index.json");
const chunkStorePath = resolve(".rag-index", "sop-chunks.json");
await buildChunkStore(resolve("sops"), chunkStorePath);
await buildLocalTfidfIndex(chunkStorePath, tfidfIndexPath);

const matchingSopSource = new LocalTfidfSopSource(
  tfidfIndexPath,
  chunkStorePath,
);
const noMatchSopSource: SopSource = { search: async () => [] };

for (const evalCase of DISK_DIAGNOSIS_EVAL_CASES) {
  test(
    `真实 DeepSeek Agent 业务验收：${evalCase.description}`,
    { timeout: 130_000 },
    async () => {
      const agent = createOpsAgent({
        diskInspectionSource: createMockDiskInspectionSource(evalCase.scenarioId),
        sopSource: evalCase.sopMode === "match" ? matchingSopSource : noMatchSopSource,
      });
      const outcome = await diagnoseDiskAlert(agent, evalCase.alert);
      const evaluation = evaluateDiskDiagnosis(evalCase, outcome);
      process.stdout.write(
        `${JSON.stringify({
          caseId: evalCase.id,
          passed: evaluation.passed,
          failures: evaluation.failures,
          terminationReason: outcome.run.terminationReason,
          stats: outcome.run.stats,
          reportError: outcome.reportError,
          report: outcome.report,
        })}\n`,
      );
      assert.equal(
        evaluation.passed,
        true,
        `${evalCase.id}: ${evaluation.failures.join("；")}`,
      );
    },
  );
}
