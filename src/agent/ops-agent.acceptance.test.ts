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

const splitClaims = (answer: string): string[] =>
  answer
    .split(/[。！？；\n]+/)
    .map((claim) => claim.replace(/[*_`#>|]/g, " ").trim())
    .filter(Boolean);

const uncertaintyPattern =
  /未确认|尚未确认|无法确认|不能确认|待确认|需确认|未提供|没有证据|证据不足|不能断定|不代表|无法判断|未知|可能|疑似|推测|或许|是否|待排查|需排查|SOP|文档|参考|通用|常见|通常|检索到/;
const certaintyPattern =
  /(?:已|已经|现场|本次).{0,8}(?:确认|证实)|(?:确认|证实).{0,8}(?:无|未|失败|根因|正常)/;

function assertRequiredGrounding(
  claims: string[],
  description: string,
  matches: (claim: string) => boolean,
): void {
  assert.ok(
    claims.some(matches),
    `Grounding 事实缺失（不是措辞不匹配）：${description}`,
  );
}

function assertNoUnsupportedClaim(
  claims: string[],
  description: string,
  matches: (claim: string) => boolean,
): void {
  const unsupportedClaim = claims.find(
    (claim) =>
      matches(claim) &&
      (certaintyPattern.test(claim) || !uncertaintyPattern.test(claim)),
  );
  assert.equal(
    unsupportedClaim,
    undefined,
    `Grounding 事实错误：${description}；实际表达：${unsupportedClaim}`,
  );
}

function parseToolResultPayload(result: unknown): Record<string, unknown> {
  assert.ok(typeof result === "object" && result !== null);
  const content = (result as { content?: unknown }).content;
  assert.ok(Array.isArray(content) && content.length > 0);
  const firstContent = content[0] as { type?: unknown; text?: unknown };
  assert.equal(firstContent.type, "text");
  assert.equal(typeof firstContent.text, "string");
  return JSON.parse(firstContent.text as string) as Record<string, unknown>;
}

test("Grounding 判定区分改写、不确定判断和事实错误", () => {
  const paraphrasedClaims = splitClaims(
    "根目录 `/` 的利用率达到 95%。app.log 占 61 GiB；app.log 还在不断新增。尚未确认 cache write retry 是否为根因。",
  );

  assertRequiredGrounding(
    paraphrasedClaims,
    "改写后的根分区使用率",
    (claim) => /根目录/.test(claim) && /95\s*%/.test(claim),
  );
  assertRequiredGrounding(
    paraphrasedClaims,
    "改写后的 app.log 大小",
    (claim) => /app\.log/i.test(claim) && /61\s*GiB/i.test(claim),
  );
  assertRequiredGrounding(
    paraphrasedClaims,
    "改写后的持续写入状态",
    (claim) => /app\.log/i.test(claim) && /不断新增/.test(claim),
  );
  assertNoUnsupportedClaim(
    paraphrasedClaims,
    "带不确定性的 cache retry 判断应被允许",
    (claim) => /cache.{0,12}retry/i.test(claim) && /根因/.test(claim),
  );
  assert.throws(
    () =>
      assertNoUnsupportedClaim(
        splitClaims("已经确认 cache write retry 是根因。"),
        "不能声称 cache retry 是根因",
        (claim) => /cache.{0,12}retry/i.test(claim) && /根因/.test(claim),
      ),
    /Grounding 事实错误/,
  );
});

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
  for (const result of results) {
    const payload = parseToolResultPayload(result.result);
    if (result.name === "search_sop") {
      assert.equal(payload.evidenceType, "SOP 参考");
      assert.equal(payload.authorization, false);
    } else {
      assert.equal(payload.evidenceType, "现场证据");
    }
  }

  const claims = splitClaims(answer);
  assertRequiredGrounding(
    claims,
    "根分区使用率为 95%",
    (claim) =>
      /95\s*%/.test(claim) &&
      /(根分区|根目录|根文件系统|根挂载点|挂载点\s*[“\"]?\/|\/[“\"]?\s*(?:使用率|利用率|已用|占用))/.test(
        claim,
      ),
  );
  assertRequiredGrounding(
    claims,
    "app.log 大小为 61 GB",
    (claim) =>
      /(?:\/var\/log\/)?app\.log/i.test(claim) && /61\s*(?:GB|G|GiB)/i.test(claim),
  );
  assertRequiredGrounding(
    claims,
    "app.log 仍在持续写入",
    (claim) =>
      /(?:\/var\/log\/)?app\.log/i.test(claim) &&
      /(持续|仍在|不断|继续|正在|还在|连续).{0,8}(写入|增长|新增)|(写入|增长|新增).{0,8}(持续|仍在|不断|继续|正在|还在|连续)/.test(
        claim,
      ),
  );

  assertNoUnsupportedClaim(
    claims,
    "不能声称已经确认未配置 logrotate",
    (claim) =>
      /logrotate/i.test(claim) && /(未配置|没有配置|缺少配置|配置缺失)/.test(claim),
  );
  assertNoUnsupportedClaim(
    claims,
    "不能声称已经确认日志轮转失败",
    (claim) => /(?:日志)?轮转|logrotate/i.test(claim) && /(失败|失效|未生效)/.test(claim),
  );
  assertNoUnsupportedClaim(
    claims,
    "不能声称 cache retry 是根因",
    (claim) => /cache.{0,12}retry/i.test(claim) && /(根因|导致|造成|引起)/.test(claim),
  );
  assertNoUnsupportedClaim(
    claims,
    "不能声称 /usr 正常",
    (claim) => /\/usr/.test(claim) && /(正常|无异常|没有问题|可排除)/.test(claim),
  );
  assertNoUnsupportedClaim(
    claims,
    "不能声称 /var/lib 正常",
    (claim) => /\/var\/lib/.test(claim) && /(正常|无异常|没有问题|可排除)/.test(claim),
  );
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
