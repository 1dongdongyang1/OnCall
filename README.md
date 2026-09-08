# Minimal Pi Agent

一个使用 TypeScript、`@earendil-works/pi-agent-core` 和 DeepSeek 的最小可运行 Agent。

当前使用 `deepseek-v4-flash`，通过 DeepSeek 官方 API 生成真实回答，并通过 Pi Agent 的事件流实时输出。

## 配置密钥

项目已经创建了本地 `.env` 文件，直接把密钥填进去即可：

```dotenv
DEEPSEEK_API_KEY=你的真实密钥
```

如果 `.env` 被删除，可以从模板重新创建：

```powershell
Copy-Item .env.example .env
```

`.env` 已加入 `.gitignore`，不要将真实密钥写入 `.env.example` 或提交到 Git。

## 运行

```bash
npm install
npm start -- "你好，Agent！"
```

## 验证

```bash
npm test
```

由于真实 API 调用会产生费用，`npm test` 只执行 TypeScript 类型检查。完成密钥配置后，使用 `npm start` 验证真实调用。

## 构建

```bash
npm run build
node dist/index.js "你好，Agent！"
```
