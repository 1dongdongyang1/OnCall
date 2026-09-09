import {
  Agent,
  type AgentEvent,
  type AgentState,
  type AgentTool,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  streamSimple,
  type AssistantMessage,
  type Model,
  type Usage,
} from "@earendil-works/pi-ai";

export type OpsRuntimeLimits = {
  maxToolCalls: number;
  maxModelTurns: number;
  agentTimeoutMs: number;
  modelRequestTimeoutMs: number;
  toolTimeoutMs: number;
};

export const DEFAULT_OPS_RUNTIME_LIMITS: OpsRuntimeLimits = {
  maxToolCalls: 10,
  maxModelTurns: 8,
  agentTimeoutMs: 120_000,
  modelRequestTimeoutMs: 45_000,
  toolTimeoutMs: 10_000,
};

export type OpsTerminationCode =
  | "completed"
  | "tool_budget_exhausted"
  | "duplicate_tool_call"
  | "tool_timeout"
  | "tool_error"
  | "agent_timeout"
  | "model_request_timeout"
  | "max_model_turns"
  | "model_error"
  | "aborted";

export type RuntimeFailurePayload = {
  kind: "runtime_control";
  code: Exclude<OpsTerminationCode, "completed">;
  message: string;
  retryable: false;
};

export type OpsUsageSummary = {
  promptTokens: number | "unavailable";
  completionTokens: number | "unavailable";
  cacheReadTokens: number | "unavailable";
  cacheWriteTokens: number | "unavailable";
  totalTokens: number | "unavailable";
  costUsd: number | "unavailable";
};

export type OpsRunStats = {
  modelTurnCount: number;
  modelRequestCount: number;
  toolCallCount: number;
  executedToolCallCount: number;
  usage: OpsUsageSummary;
};

export type OpsRunResult = {
  terminationReason: OpsTerminationCode;
  terminationMessage: string;
  stats: OpsRunStats;
};

type RuntimeOptions = {
  model: Model<any>;
  tools: AgentTool<any>[];
  systemPrompt: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  streamFn?: StreamFn;
  limits?: Partial<OpsRuntimeLimits>;
};

type MutableStats = Omit<OpsRunStats, "usage"> & {
  usageAvailable: boolean;
  usage: Usage;
};

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function validateLimits(limits: OpsRuntimeLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`运行时限制 ${name} 必须是正整数`);
    }
  }
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, normalizeJson(child)]),
    );
  }
  return value;
}

export function createToolCallKey(toolName: string, args: unknown): string {
  return `${toolName}:${JSON.stringify(normalizeJson(args))}`;
}

function createFailureMessage(
  model: Model<any>,
  payload: RuntimeFailurePayload,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: structuredClone(EMPTY_USAGE),
    stopReason: payload.code === "aborted" || payload.code === "agent_timeout"
      ? "aborted"
      : "error",
    errorMessage: JSON.stringify(payload),
    timestamp: Date.now(),
  };
}

function failureResult(payload: RuntimeFailurePayload) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    details: payload,
    isError: true,
    terminate: true,
  };
}

export class OpsAgentRuntime {
  private readonly agent: Agent;
  private readonly limits: OpsRuntimeLimits;
  private readonly baseStreamFn: StreamFn;
  private termination?: RuntimeFailurePayload;
  private stats: MutableStats = this.createStats();
  private readonly seenToolCalls = new Set<string>();
  private readonly toolFailures = new Map<string, RuntimeFailurePayload>();

  constructor(options: RuntimeOptions) {
    this.limits = { ...DEFAULT_OPS_RUNTIME_LIMITS, ...options.limits };
    validateLimits(this.limits);
    this.baseStreamFn = options.streamFn ?? streamSimple;
    this.agent = new Agent({
      initialState: {
        systemPrompt: options.systemPrompt,
        model: options.model,
        thinkingLevel: options.thinkingLevel ?? "off",
        tools: options.tools.map((tool) => this.wrapTool(tool)),
      },
      streamFn: this.createControlledStreamFn(),
      toolExecution: "sequential",
      afterToolCall: async (context) => {
        const controlledFailure = this.toolFailures.get(context.toolCall.id);
        if (controlledFailure) {
          return failureResult(controlledFailure);
        }
        if (context.isError) {
          const payload = this.stop(
            "tool_error",
            `工具 ${context.toolCall.name} 执行失败，诊断已安全停止`,
          );
          return failureResult(payload);
        }
        return undefined;
      },
    });
    this.agent.subscribe((event) => this.observe(event));
  }

  get state(): AgentState {
    return this.agent.state;
  }

  get signal(): AbortSignal | undefined {
    return this.agent.signal;
  }

  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void,
  ): () => void {
    return this.agent.subscribe(listener);
  }

  abort(): void {
    this.stop("aborted", "运行被外部请求中止");
    this.agent.abort();
  }

  async prompt(input: string): Promise<OpsRunResult> {
    if (this.agent.state.isStreaming) {
      throw new Error("Agent 已在处理请求，不能并发启动第二个运行");
    }
    this.resetRunState();
    const timer = setTimeout(() => {
      this.stop(
        "agent_timeout",
        `Agent 总运行时间超过 ${this.limits.agentTimeoutMs}ms`,
      );
      this.agent.abort();
    }, this.limits.agentTimeoutMs);

    try {
      await this.agent.prompt(input);
    } finally {
      clearTimeout(timer);
    }

    if (!this.termination) {
      const lastAssistant = [...this.agent.state.messages]
        .reverse()
        .find((message): message is AssistantMessage => message.role === "assistant");
      if (lastAssistant?.stopReason === "error") {
        this.stop("model_error", lastAssistant.errorMessage || "模型请求失败");
      } else if (lastAssistant?.stopReason === "aborted") {
        this.stop("aborted", lastAssistant.errorMessage || "运行被中止");
      }
    }

    return this.snapshot();
  }

  private createStats(): MutableStats {
    return {
      modelTurnCount: 0,
      modelRequestCount: 0,
      toolCallCount: 0,
      executedToolCallCount: 0,
      usageAvailable: false,
      usage: structuredClone(EMPTY_USAGE),
    };
  }

  private resetRunState(): void {
    this.termination = undefined;
    this.stats = this.createStats();
    this.seenToolCalls.clear();
    this.toolFailures.clear();
  }

  private stop(
    code: Exclude<OpsTerminationCode, "completed">,
    message: string,
  ): RuntimeFailurePayload {
    this.termination ??= {
      kind: "runtime_control",
      code,
      message,
      retryable: false,
    };
    return this.termination;
  }

  private observe(event: AgentEvent): void {
    if (event.type === "tool_execution_start") {
      this.stats.toolCallCount += 1;
    }
    if (event.type === "tool_execution_end" && event.isError && !this.termination) {
      this.stop("tool_error", `工具 ${event.toolName} 调用失败，诊断已安全停止`);
      this.agent.abort();
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const usage = event.message.usage;
      if (usage.totalTokens > 0) {
        this.stats.usageAvailable = true;
        this.stats.usage.input += usage.input;
        this.stats.usage.output += usage.output;
        this.stats.usage.cacheRead += usage.cacheRead;
        this.stats.usage.cacheWrite += usage.cacheWrite;
        this.stats.usage.totalTokens += usage.totalTokens;
        this.stats.usage.cost.input += usage.cost.input;
        this.stats.usage.cost.output += usage.cost.output;
        this.stats.usage.cost.cacheRead += usage.cost.cacheRead;
        this.stats.usage.cost.cacheWrite += usage.cost.cacheWrite;
        this.stats.usage.cost.total += usage.cost.total;
      }
    }
  }

  private wrapTool(tool: AgentTool<any>): AgentTool<any> {
    return {
      ...tool,
      execute: async (toolCallId, args, parentSignal, onUpdate) => {
        const key = createToolCallKey(tool.name, args);
        if (this.seenToolCalls.has(key)) {
          const failure = this.stop(
            "duplicate_tool_call",
            `拒绝重复工具调用：${key}`,
          );
          this.toolFailures.set(toolCallId, failure);
          throw new Error(failure.message);
        }
        if (this.stats.executedToolCallCount >= this.limits.maxToolCalls) {
          const failure = this.stop(
            "tool_budget_exhausted",
            `工具调用预算已耗尽：最多 ${this.limits.maxToolCalls} 次`,
          );
          this.toolFailures.set(toolCallId, failure);
          throw new Error(failure.message);
        }

        this.seenToolCalls.add(key);
        this.stats.executedToolCallCount += 1;
        const timeoutController = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          timeoutController.abort();
        }, this.limits.toolTimeoutMs);
        const signal = parentSignal
          ? AbortSignal.any([parentSignal, timeoutController.signal])
          : timeoutController.signal;
        let abortListener: (() => void) | undefined;

        try {
          signal.throwIfAborted();
          const aborted = new Promise<never>((_resolve, reject) => {
            abortListener = () => reject(new Error("tool execution aborted"));
            signal.addEventListener(
              "abort",
              abortListener,
              { once: true },
            );
          });
          return await Promise.race([
            tool.execute(toolCallId, args, signal, onUpdate),
            aborted,
          ]);
        } catch (error) {
          let failure: RuntimeFailurePayload;
          if (timedOut) {
            failure = this.stop(
              "tool_timeout",
              `工具 ${tool.name} 执行超过 ${this.limits.toolTimeoutMs}ms`,
            );
          } else if (parentSignal?.aborted) {
            failure = this.termination ?? this.stop("aborted", "工具执行被中止");
          } else {
            const message = error instanceof Error ? error.message : String(error);
            failure = this.stop(
              "tool_error",
              `工具 ${tool.name} 执行失败：${message}`,
            );
          }
          this.toolFailures.set(toolCallId, failure);
          throw error;
        } finally {
          clearTimeout(timer);
          if (abortListener) {
            signal.removeEventListener("abort", abortListener);
          }
        }
      },
    };
  }

  private createControlledStreamFn(): StreamFn {
    return (model, context, options) => {
      if (this.termination) {
        return this.closedFailureStream(model, this.termination);
      }
      if (this.stats.modelTurnCount >= this.limits.maxModelTurns) {
        return this.closedFailureStream(
          model,
          this.stop(
            "max_model_turns",
            `模型轮数达到上限：${this.limits.maxModelTurns}`,
          ),
        );
      }

      this.stats.modelTurnCount += 1;
      this.stats.modelRequestCount += 1;
      const output = createAssistantMessageEventStream();
      const timeoutController = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
      }, this.limits.modelRequestTimeoutMs);
      const signal = options?.signal
        ? AbortSignal.any([options.signal, timeoutController.signal])
        : timeoutController.signal;

      void (async () => {
        let abortListener: (() => void) | undefined;
        try {
          signal.throwIfAborted();
          const aborted = new Promise<never>((_resolve, reject) => {
            abortListener = () => reject(new Error("model request aborted"));
            signal.addEventListener("abort", abortListener, { once: true });
          });
          const source = await Promise.race([
            Promise.resolve(
              this.baseStreamFn(model, context, {
                ...options,
                signal,
                timeoutMs: this.limits.modelRequestTimeoutMs,
              }),
            ),
            aborted,
          ]);
          const iterator = source[Symbol.asyncIterator]();

          while (true) {
            const next = await Promise.race([iterator.next(), aborted]);
            if (next.done) {
              output.end(await Promise.race([source.result(), aborted]));
              return;
            }
            if (
              next.value.type === "error" &&
              (timedOut || options?.signal?.aborted)
            ) {
              const failure = timedOut
                ? this.stop(
                    "model_request_timeout",
                    `单次模型请求超过 ${this.limits.modelRequestTimeoutMs}ms`,
                  )
                : this.termination ?? this.stop("aborted", "模型请求被中止");
              const message = createFailureMessage(model, failure);
              output.push({
                type: "error",
                reason: message.stopReason === "aborted" ? "aborted" : "error",
                error: message,
              });
              output.end(message);
              return;
            }
            if (next.value.type === "error" && !this.termination) {
              this.stop(
                "model_error",
                next.value.error.errorMessage || "模型请求失败",
              );
            }
            output.push(next.value);
            if (next.value.type === "done") {
              output.end(next.value.message);
              return;
            }
            if (next.value.type === "error") {
              output.end(next.value.error);
              return;
            }
          }
        } catch (error) {
          const failure = timedOut
            ? this.stop(
                "model_request_timeout",
                `单次模型请求超过 ${this.limits.modelRequestTimeoutMs}ms`,
              )
            : this.termination ??
              this.stop(
                options?.signal?.aborted ? "aborted" : "model_error",
                error instanceof Error ? error.message : String(error),
              );
          const message = createFailureMessage(model, failure);
          output.push({
            type: "error",
            reason: message.stopReason === "aborted" ? "aborted" : "error",
            error: message,
          });
          output.end(message);
        } finally {
          clearTimeout(timer);
          if (abortListener) {
            signal.removeEventListener("abort", abortListener);
          }
        }
      })();

      return output;
    };
  }

  private closedFailureStream(
    model: Model<any>,
    failure: RuntimeFailurePayload,
  ) {
    const output = createAssistantMessageEventStream();
    queueMicrotask(() => {
      const message = createFailureMessage(model, failure);
      output.push({
        type: "error",
        reason: message.stopReason === "aborted" ? "aborted" : "error",
        error: message,
      });
      output.end(message);
    });
    return output;
  }

  private snapshot(): OpsRunResult {
    const available = this.stats.usageAvailable;
    return {
      terminationReason: this.termination?.code ?? "completed",
      terminationMessage: this.termination?.message ?? "Agent 正常完成",
      stats: {
        modelTurnCount: this.stats.modelTurnCount,
        modelRequestCount: this.stats.modelRequestCount,
        toolCallCount: this.stats.toolCallCount,
        executedToolCallCount: this.stats.executedToolCallCount,
        usage: {
          promptTokens: available ? this.stats.usage.input : "unavailable",
          completionTokens: available ? this.stats.usage.output : "unavailable",
          cacheReadTokens: available ? this.stats.usage.cacheRead : "unavailable",
          cacheWriteTokens: available ? this.stats.usage.cacheWrite : "unavailable",
          totalTokens: available ? this.stats.usage.totalTokens : "unavailable",
          costUsd: available ? this.stats.usage.cost.total : "unavailable",
        },
      },
    };
  }
}
