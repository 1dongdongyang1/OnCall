import assert from "node:assert/strict";
import test from "node:test";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  registerFauxProvider,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai";
import type {
  DirectoryUsage,
  DiskInspectionSource,
  DiskUsage,
  FileInspection,
} from "../data-sources/disk-inspection-source.js";
import type { SopSource } from "../data-sources/sop-source.js";
import { createOpsAgent } from "./ops-agent.js";
import {
  createToolCallKey,
  type OpsAgentRuntime,
  type OpsRunResult,
} from "./ops-agent-runtime.js";
import { createSearchSopTool } from "../tools/search-sop.js";

const DISK_USAGE: DiskUsage = {
  node: "node-01",
  filesystems: [
    {
      mountPoint: "/",
      totalGb: 100,
      usedGb: 95,
      availableGb: 5,
      usagePercent: 95,
    },
  ],
};

const DIRECTORY_USAGE: DirectoryUsage = {
  node: "node-01",
  path: "/",
  entries: [
    { path: "/var", sizeGb: 72, kind: "directory", inspectable: true },
  ],
};

const FILE_INSPECTION: FileInspection = {
  node: "node-01",
  path: "/var/log/app.log",
  sizeGb: 61,
  owner: "app",
  modifiedAt: "2026-09-08T11:45:00+08:00",
  observations: ["文件仍在持续写入"],
};

const emptySopSource: SopSource = {
  search: async () => [],
};

function createDiskSource(
  overrides: Partial<DiskInspectionSource> = {},
): DiskInspectionSource {
  return {
    getDiskUsage: async () => structuredClone(DISK_USAGE),
    listLargeDirectories: async () => structuredClone(DIRECTORY_USAGE),
    inspectFile: async () => structuredClone(FILE_INSPECTION),
    ...overrides,
  };
}

function createRuntime(
  registration: FauxProviderRegistration,
  source: DiskInspectionSource,
  limits: Parameters<typeof createOpsAgent>[0]["limits"] = {},
): OpsAgentRuntime {
  return createOpsAgent({
    diskInspectionSource: source,
    sopSource: emptySopSource,
    model: registration.getModel(),
    limits: {
      agentTimeoutMs: 1_000,
      modelRequestTimeoutMs: 500,
      toolTimeoutMs: 200,
      maxModelTurns: 6,
      maxToolCalls: 6,
      ...limits,
    },
  });
}

function toolResultPayloads(agent: OpsAgentRuntime): Array<Record<string, unknown>> {
  return agent.state.messages
    .filter((message) => message.role === "toolResult")
    .map((message) => {
      const text = message.content.find((content) => content.type === "text");
      assert.ok(text?.type === "text");
      return JSON.parse(text.text) as Record<string, unknown>;
    });
}

function assertSafeForcedStop(agent: OpsAgentRuntime, result: OpsRunResult): void {
  assert.notEqual(result.terminationReason, "completed");
  const assistantText = agent.state.messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      message.content.flatMap((content) =>
        content.type === "text" ? [content.text] : [],
      ),
    )
    .join("\n");
  assert.doesNotMatch(
    assistantText,
    /已确认.*(?:logrotate|轮转失败|cache.*retry.*根因|\/usr.*正常|\/var\/lib.*正常)/i,
  );
}

test("工具调用 key 递归规范化对象字段但保留数组顺序", () => {
  assert.equal(
    createToolCallKey("inspect", {
      node: "node-01",
      nested: { path: "/var", flags: ["a", "b"] },
    }),
    createToolCallKey("inspect", {
      nested: { flags: ["a", "b"], path: "/var" },
      node: "node-01",
    }),
  );
  assert.notEqual(
    createToolCallKey("inspect", { flags: ["a", "b"] }),
    createToolCallKey("inspect", { flags: ["b", "a"] }),
  );
});

test("SOP Tool Result 使用带 authorization=false 的类型化参考载荷", async () => {
  const tool = createSearchSopTool(emptySopSource);
  const result = await tool.execute("call-1", { query: "不存在的 SOP" });
  assert.deepEqual(result.details, {
    evidenceType: "SOP 参考",
    authorization: false,
    found: false,
    query: "不存在的 SOP",
    results: [],
  });
});

test("重复 toolName + args 在真实工具执行前被拒绝", async () => {
  const registration = registerFauxProvider();
  let executions = 0;
  registration.setResponses([
    fauxAssistantMessage(
      fauxToolCall("list_large_directories", { node: "node-01", path: "/" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("list_large_directories", { path: "/", node: "node-01" }),
      { stopReason: "toolUse" },
    ),
  ]);
  const agent = createRuntime(
    registration,
    createDiskSource({
      listLargeDirectories: async () => {
        executions += 1;
        return structuredClone(DIRECTORY_USAGE);
      },
    }),
  );

  try {
    const result = await agent.prompt("测试重复调用");
    assert.equal(result.terminationReason, "duplicate_tool_call");
    assert.equal(result.stats.toolCallCount, 2);
    assert.equal(result.stats.executedToolCallCount, 1);
    assert.equal(executions, 1);
    assert.equal(toolResultPayloads(agent).at(-1)?.code, "duplicate_tool_call");
    assertSafeForcedStop(agent, result);
  } finally {
    registration.unregister();
  }
});

test("工具预算耗尽返回明确终止原因且不执行超额调用", async () => {
  const registration = registerFauxProvider();
  let diskExecutions = 0;
  let directoryExecutions = 0;
  registration.setResponses([
    fauxAssistantMessage(
      fauxToolCall("get_disk_usage", { node: "node-01" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("list_large_directories", { node: "node-01", path: "/" }),
      { stopReason: "toolUse" },
    ),
  ]);
  const agent = createRuntime(
    registration,
    createDiskSource({
      getDiskUsage: async () => {
        diskExecutions += 1;
        return structuredClone(DISK_USAGE);
      },
      listLargeDirectories: async () => {
        directoryExecutions += 1;
        return structuredClone(DIRECTORY_USAGE);
      },
    }),
    { maxToolCalls: 1 },
  );

  try {
    const result = await agent.prompt("测试预算");
    assert.equal(result.terminationReason, "tool_budget_exhausted");
    assert.equal(result.stats.toolCallCount, 2);
    assert.equal(result.stats.executedToolCallCount, 1);
    assert.equal(diskExecutions, 1);
    assert.equal(directoryExecutions, 0);
    assert.equal(toolResultPayloads(agent).at(-1)?.code, "tool_budget_exhausted");
    assertSafeForcedStop(agent, result);
  } finally {
    registration.unregister();
  }
});

test("工具超时通过 AbortSignal 中止并以 isError 安全结束", async () => {
  const registration = registerFauxProvider();
  registration.setResponses([
    fauxAssistantMessage(
      fauxToolCall("get_disk_usage", { node: "node-01" }),
      { stopReason: "toolUse" },
    ),
  ]);
  let observedAbort = false;
  const agent = createRuntime(
    registration,
    createDiskSource({
      getDiskUsage: async (_node, signal) =>
        await new Promise<DiskUsage>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    }),
    { toolTimeoutMs: 20 },
  );

  try {
    const result = await agent.prompt("测试工具超时");
    const toolMessage = agent.state.messages.find(
      (message) => message.role === "toolResult",
    );
    assert.equal(result.terminationReason, "tool_timeout");
    assert.equal(observedAbort, true);
    assert.equal(toolMessage?.role === "toolResult" && toolMessage.isError, true);
    assertSafeForcedStop(agent, result);
  } finally {
    registration.unregister();
  }
});

test("工具执行异常转为 isError 并阻止模型补写结论", async () => {
  const registration = registerFauxProvider();
  registration.setResponses([
    fauxAssistantMessage(
      fauxToolCall("get_disk_usage", { node: "node-01" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxText("已经确认 cache retry 是根因")),
  ]);
  const agent = createRuntime(
    registration,
    createDiskSource({
      getDiskUsage: async () => {
        throw new Error("source failed");
      },
    }),
  );

  try {
    const result = await agent.prompt("测试工具异常");
    assert.equal(result.terminationReason, "tool_error");
    assert.equal(result.stats.modelRequestCount, 1);
    assert.equal(registration.getPendingResponseCount(), 1);
    assertSafeForcedStop(agent, result);
  } finally {
    registration.unregister();
  }
});

test("最大模型轮数在下一次请求前结束工具循环", async () => {
  const registration = registerFauxProvider();
  registration.setResponses([
    fauxAssistantMessage(
      fauxToolCall("get_disk_usage", { node: "node-01" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxText("不应被调用")),
  ]);
  const agent = createRuntime(registration, createDiskSource(), {
    maxModelTurns: 1,
  });

  try {
    const result = await agent.prompt("测试模型轮数");
    assert.equal(result.terminationReason, "max_model_turns");
    assert.equal(result.stats.modelTurnCount, 1);
    assert.equal(result.stats.modelRequestCount, 1);
    assert.equal(result.stats.toolCallCount, 1);
    assert.equal(registration.getPendingResponseCount(), 1);
    assertSafeForcedStop(agent, result);
  } finally {
    registration.unregister();
  }
});

test("单次模型请求超时会中止挂起的 provider 流", async () => {
  const registration = registerFauxProvider();
  registration.setResponses([
    async () => await new Promise(() => undefined),
  ]);
  const agent = createRuntime(registration, createDiskSource(), {
    modelRequestTimeoutMs: 20,
    agentTimeoutMs: 500,
  });

  try {
    const result = await agent.prompt("测试模型请求超时");
    assert.equal(result.terminationReason, "model_request_timeout");
    assert.equal(result.stats.modelRequestCount, 1);
    assert.equal(result.stats.usage.promptTokens, "unavailable");
    assert.equal(result.stats.usage.costUsd, "unavailable");
    assertSafeForcedStop(agent, result);
  } finally {
    registration.unregister();
  }
});

test("Agent 总超时优先于较长的单次模型请求超时", async () => {
  const registration = registerFauxProvider();
  registration.setResponses([
    async () => await new Promise(() => undefined),
  ]);
  const agent = createRuntime(registration, createDiskSource(), {
    agentTimeoutMs: 20,
    modelRequestTimeoutMs: 500,
  });

  try {
    const result = await agent.prompt("测试 Agent 总超时");
    assert.equal(result.terminationReason, "agent_timeout");
    assert.equal(result.stats.modelRequestCount, 1);
    assert.equal(result.stats.usage.totalTokens, "unavailable");
    assertSafeForcedStop(agent, result);
  } finally {
    registration.unregister();
  }
});

test("成功运行聚合模型 usage 并返回类型化现场证据", async () => {
  const registration = registerFauxProvider();
  registration.setResponses([
    fauxAssistantMessage(
      fauxToolCall("get_disk_usage", { node: "node-01" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxText("根分区使用率为 95%。")),
  ]);
  const agent = createRuntime(registration, createDiskSource());

  try {
    const result = await agent.prompt("检查 node-01 磁盘");
    const evidence = toolResultPayloads(agent)[0];
    assert.equal(result.terminationReason, "completed");
    assert.equal(result.stats.modelTurnCount, 2);
    assert.equal(result.stats.modelRequestCount, 2);
    assert.equal(result.stats.toolCallCount, 1);
    assert.equal(result.stats.executedToolCallCount, 1);
    assert.equal(typeof result.stats.usage.promptTokens, "number");
    assert.equal(typeof result.stats.usage.completionTokens, "number");
    assert.equal(typeof result.stats.usage.costUsd, "number");
    assert.equal(evidence?.evidenceType, "现场证据");
    assert.equal(evidence?.tool, "get_disk_usage");
  } finally {
    registration.unregister();
  }
});
