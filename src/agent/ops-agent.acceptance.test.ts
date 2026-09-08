import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { MarkdownSopSource } from "../data-sources/markdown-sop-source.js";
import { mockDiskInspectionSource } from "../mocks/mock-disk-inspection-source.js";
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

  const agent = createOpsAgent({
    diskInspectionSource: mockDiskInspectionSource,
    sopSource: new MarkdownSopSource(resolve("sops")),
  });
  const calls: ToolCallRecord[] = [];
  const results: Array<{ name: string; isError: boolean }> = [];
  let answer = "";

  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      calls.push({ name: event.toolName, args: event.args });
    }
    if (event.type === "tool_execution_end") {
      results.push({ name: event.toolName, isError: event.isError });
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

  assert.deepEqual(calls, [
    { name: "get_disk_usage", args: { node: "node-01" } },
    { name: "list_large_directories", args: { node: "node-01", path: "/" } },
    { name: "list_large_directories", args: { node: "node-01", path: "/var" } },
    { name: "list_large_directories", args: { node: "node-01", path: "/var/log" } },
    { name: "inspect_file", args: { node: "node-01", path: "/var/log/app.log" } },
    { name: "search_sop", args: { query: "磁盘使用率过高" } },
  ]);
  assert.equal(results.length, calls.length);
  assert.ok(results.every((result) => !result.isError));
  assert.match(answer, /证据/);
  assert.match(answer, /判断/);
  assert.match(answer, /待确认事项/);
  assert.match(answer, /安全处置建议/);
  assert.match(answer, /95%/);
  assert.match(answer, /\/var\/log\/app\.log/);
  assert.match(answer, /61GB/);
  assert.match(answer, /SOP-DISK-USAGE-HIGH/);
  assert.doesNotMatch(answer, /说明[^。\n]{0,80}(未配置|未执行有效)/);
  assert.doesNotMatch(answer, /归档或截断/);
  assert.doesNotMatch(answer, /不属于[“"]?已删除但仍占用/);

  process.stdout.write(
    `\n[acceptance-tool-calls] ${JSON.stringify(calls)}\n` +
      `[acceptance-tool-results] ${JSON.stringify(results)}\n` +
      `[acceptance-final-answer]\n${answer}\n`,
  );
});
