import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createOpsAgent } from "./agent/ops-agent.js";

const prompt = process.argv.slice(2).join(" ") || "你好，请介绍一下自己。";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error(
    "缺少 DEEPSEEK_API_KEY。请复制 .env.example 为 .env，并填入你的 DeepSeek API Key。",
  );
}

const agent = createOpsAgent();

let toolCallCount = 0;

agent.subscribe((event) => {
  if (event.type === "tool_execution_start") {
    toolCallCount += 1;
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
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await agent.prompt(prompt);
process.stdout.write("\n");

const lastMessage = agent.state.messages.at(-1);
if (lastMessage?.role === "assistant" && lastMessage.stopReason === "error") {
  throw new Error(lastMessage.errorMessage || "DeepSeek 请求失败");
}

process.stdout.write(`[verification] toolCallCount=${toolCallCount}\n`);
