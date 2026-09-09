import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { createOpsAgent } from "./agent/ops-agent.js";
import {
  diagnoseDiskAlert,
  parseDiskAlertInput,
  type DiskAlertInput,
} from "./agent/disk-diagnosis.js";
import { mockDiskInspectionSource } from "./mocks/mock-disk-inspection-source.js";
import { buildChunkStore } from "./rag/chunk-store.js";
import {
  buildLocalTfidfIndex,
  LocalTfidfSopSource,
} from "./rag/local-tfidf-index.js";

const prompt = process.argv.slice(2).join(" ") || "你好，请介绍一下自己。";
const structuredAlert: DiskAlertInput | undefined = prompt.trim().startsWith("{")
  ? parseDiskAlertInput(prompt)
  : undefined;

if (existsSync(".env")) {
  loadEnvFile(".env");
}

if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error(
    "缺少 DEEPSEEK_API_KEY。请复制 .env.example 为 .env，并填入你的 DeepSeek API Key。",
  );
}

const tfidfIndexPath = resolve(".rag-index", "sop-tfidf-index.json");
const chunkStorePath = resolve(".rag-index", "sop-chunks.json");
await buildChunkStore(resolve("sops"), chunkStorePath);
await buildLocalTfidfIndex(chunkStorePath, tfidfIndexPath);

const agent = createOpsAgent({
  diskInspectionSource: mockDiskInspectionSource,
  sopSource: new LocalTfidfSopSource(tfidfIndexPath, chunkStorePath),
});

agent.subscribe((event) => {
  if (event.type === "tool_execution_start") {
    process.stdout.write(
      `\n[tool-call] name=${event.toolName} args=${JSON.stringify(event.args)}\n`,
    );
  }

  if (event.type === "tool_execution_end") {
    process.stdout.write(
      `[tool-result] name=${event.toolName} isError=${event.isError} result=${JSON.stringify(event.result)}\n\n`,
    );
  }

  if (
    !structuredAlert &&
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

const outcome = structuredAlert
  ? await diagnoseDiskAlert(agent, structuredAlert)
  : undefined;
const run = outcome?.run ?? await agent.prompt(prompt);
process.stdout.write("\n");

if (outcome?.report) {
  process.stdout.write(`[diagnostic-report] ${JSON.stringify(outcome.report, null, 2)}\n`);
}
if (outcome?.reportError) {
  process.stderr.write(`[diagnostic-report-error] ${outcome.reportError}\n`);
  process.exitCode = 1;
}

process.stdout.write(
  `[verification] terminationReason=${run.terminationReason} ` +
    `modelTurnCount=${run.stats.modelTurnCount} ` +
    `modelRequestCount=${run.stats.modelRequestCount} ` +
    `toolCallCount=${run.stats.toolCallCount} ` +
    `executedToolCallCount=${run.stats.executedToolCallCount} ` +
    `usage=${JSON.stringify(run.stats.usage)}\n`,
);
if (run.terminationReason !== "completed") {
  process.exitCode = 1;
}
