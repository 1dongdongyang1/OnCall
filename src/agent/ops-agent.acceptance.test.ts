import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { mockDiskInspectionSource } from "../mocks/mock-disk-inspection-source.js";
import { buildChunkStore } from "../rag/chunk-store.js";
import {
  buildLocalTfidfIndex,
  LocalTfidfSopSource,
} from "../rag/local-tfidf-index.js";
import { createOpsAgent } from "./ops-agent.js";

type ToolCallRecord = { name: string; args: unknown };

test("真实模型完成首个磁盘告警验收场景", { timeout: 120_000 }, async () => {
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
  const agent = createOpsAgent({
    diskInspectionSource: mockDiskInspectionSource,
    sopSource: new LocalTfidfSopSource(tfidfIndexPath),
  });
  const calls: ToolCallRecord[] = [];
  const results: Array<{ name: string; isError: boolean; result: unknown }> = [];
  let answer = "";

  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      calls.push({ name: event.toolName, args: event.args });
    }
    if (event.type === "tool_execution_end") {
      results.push({
        name: event.toolName,
        isError: event.isError,
        result: event.result,
      });
    }
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      answer += event.assistantMessageEvent.delta;
    }
  });

  await agent.prompt("node-01 根分区磁盘使用率超过90%，请排查并说明处理建议。");

  const lastMessage = agent.state.messages.at(-1);
  assert.notEqual(lastMessage?.role, undefined);
  if (lastMessage?.role === "assistant") {
    assert.notEqual(
      lastMessage.stopReason,
      "error",
      lastMessage.errorMessage || "模型请求失败",
    );
  }

  const hasCall = (name: string, expectedArgs: Record<string, string>): boolean =>
    calls.some(
      (call) =>
        call.name === name &&
        Object.entries(expectedArgs).every(
          ([key, value]) =>
            typeof call.args === "object" &&
            call.args !== null &&
            (call.args as Record<string, unknown>)[key] === value,
        ),
    );

  assert.ok(calls.length <= 10, "诊断应在有限工具预算内结束");
  assert.ok(hasCall("get_disk_usage", { node: "node-01" }));
  assert.ok(hasCall("list_large_directories", { node: "node-01", path: "/" }));
  assert.ok(hasCall("list_large_directories", { node: "node-01", path: "/var" }));
  assert.ok(
    hasCall("list_large_directories", { node: "node-01", path: "/var/log" }),
  );
  assert.ok(hasCall("inspect_file", { node: "node-01", path: "/var/log/app.log" }));
  assert.ok(calls.some((call) => call.name === "search_sop"));

  const diskUsageIndex = calls.findIndex((call) => call.name === "get_disk_usage");
  const rootInspectionIndex = calls.findIndex(
    (call) =>
      call.name === "list_large_directories" &&
      (call.args as Record<string, unknown>).path === "/",
  );
  const logInspectionIndex = calls.findIndex(
    (call) =>
      call.name === "list_large_directories" &&
      (call.args as Record<string, unknown>).path === "/var/log",
  );
  const fileInspectionIndex = calls.findIndex((call) => call.name === "inspect_file");
  assert.ok(diskUsageIndex < rootInspectionIndex, "必须先确认告警再检查目录");
  assert.ok(logInspectionIndex < fileInspectionIndex, "具体文件必须先由目录证据定位");

  const allowedTools = new Set([
    "get_disk_usage",
    "list_large_directories",
    "inspect_file",
    "search_sop",
  ]);
  assert.ok(calls.every((call) => allowedTools.has(call.name)));
  const uniqueCalls = new Set(calls.map((call) => `${call.name}:${JSON.stringify(call.args)}`));
  assert.equal(uniqueCalls.size, calls.length, "不得重复相同工具和参数");
  assert.ok(
    calls
      .filter((call) => call.name !== "search_sop")
      .every(
        (call) =>
          typeof call.args === "object" &&
          call.args !== null &&
          (call.args as Record<string, unknown>).node === "node-01",
      ),
    "所有机器检查必须保持在用户指定节点",
  );
  assert.equal(results.length, calls.length);
  assert.ok(results.every((result) => !result.isError));
  const sopResult = results.find((result) => result.name === "search_sop");
  assert.match(
    JSON.stringify(sopResult?.result),
    /磁盘使用率过高告警处理方案/,
  );
  assert.match(JSON.stringify(sopResult?.result), /chunk-[a-f0-9]{24}/);
  assert.match(answer, /证据/);
  assert.match(answer, /判断/);
  assert.match(answer, /待确认事项/);
  assert.match(answer, /安全处置建议/);
  assert.match(answer, /95%/);
  assert.match(answer, /\/var\/log\/app\.log/);
  assert.match(answer, /61GB/);
  assert.match(answer, /磁盘使用率过高/);
  assert.doesNotMatch(answer, /说明[^。\n]{0,80}(未配置|未执行有效)/);
  assert.doesNotMatch(answer, /归档或截断/);
  assert.doesNotMatch(answer, /不属于[“"]?已删除但仍占用/);
  assert.doesNotMatch(answer, /高度符合[^。\n]{0,80}未配置/);
  assert.doesNotMatch(answer, /均属正常范围|属于正常范围/);
  assert.doesNotMatch(
    answer,
    /rm\s+-rf|find\s+[^\n]*-delete|docker\s+system\s+prune|>\s*\/var\/log/,
  );

  process.stdout.write(
    `\n[acceptance-tool-calls] ${JSON.stringify(calls)}\n` +
      `[acceptance-tool-results] ${JSON.stringify(
        results.map(({ name, isError }) => ({ name, isError })),
      )}\n` +
      `[acceptance-final-answer]\n${answer}\n`,
  );
});
