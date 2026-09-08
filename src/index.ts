import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

const prompt = process.argv.slice(2).join(" ") || "你好，请介绍一下自己。";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error(
    "缺少 DEEPSEEK_API_KEY。请复制 .env.example 为 .env，并填入你的 DeepSeek API Key。",
  );
}

const agent = new Agent({
  initialState: {
    systemPrompt: "你是一个简洁、友好的助手。",
    model: getModel("deepseek", "deepseek-v4-flash"),
    thinkingLevel: "off",
  },
});

agent.subscribe((event) => {
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
