# OnCall Agent

一个面向值班与故障响应场景的 TypeScript Agent。项目使用 DeepSeek 理解故障问题，通过 Pi Agent 完成模型调用、Tool Calling 和消息循环，并调用受控工具查询 SOP 后生成处置建议。

## 项目目标

OnCall Agent 的目标是把“故障描述 → 收集只读证据 → 输出有依据的判断”串成一条可观察、可验证的处理链路。

首个磁盘告警事件使用固定 Mock 数据跑通以下链路：

```text
磁盘使用率 > 90%
  → get_disk_usage：/=95%
  → list_large_directories("/")：/var=72G
  → list_large_directories("/var")：/var/log=65G
  → 判断日志异常增长，需要进一步确认日志类型
```

## 当前能力

- 使用 `deepseek-v4-flash` 进行真实模型推理。
- 使用 `@earendil-works/pi-agent-core` 管理 Agent 循环和工具调用。
- 提供只读的 `search_sop`、`get_disk_usage` 和 `list_large_directories` 工具。
- 工具通过数据源接口获取结果，当前注入独立的 Mock 数据源。
- 支持 GPU Xid 79 和 GPU 温度过高两类 mock SOP。
- 支持磁盘根分区使用率过高的首个固定诊断事件。
- 输出工具名、调用参数、执行结果和调用次数，便于验证 Tool Calling。
- 通过 `.env` 管理 DeepSeek API Key。

## 当前边界

- 程序入口目前注入 Mock 数据源，不会读取真实主机或知识库。
- 当前只输出诊断与处置建议，不会执行重启、隔离节点等变更操作。
- 尚未接入监控告警、CMDB、工单系统或会话持久化。
- `npm test` 当前只做 TypeScript 类型检查，不会自动发起付费模型请求。

## 技术组成

- Node.js：程序运行环境。
- TypeScript：业务代码与类型检查。
- Pi Agent Core：Agent 状态、消息循环和 Tool Calling。
- Pi AI：DeepSeek 模型适配。
- TypeBox：工具参数 Schema。

## 配置密钥

项目根目录的 `.env` 用于保存本地密钥：

```dotenv
DEEPSEEK_API_KEY=你的真实密钥
```

如果 `.env` 不存在，可以从模板创建：

```powershell
Copy-Item .env.example .env
```

`.env` 已加入 `.gitignore`。不要把真实密钥写入 `.env.example` 或提交到 Git。

## 安装与运行

首次下载项目后安装依赖：

```powershell
npm ci
```

启动 Agent：

```powershell
npm start -- "GPU 报错 Xid 79，应该怎么处理？"
```

运行首个磁盘告警事件：

```powershell
npm start -- "告警：磁盘使用率超过 90%，请定位原因"
```

成功调用工具时，终端会输出类似记录：

```text
[tool-call] name=search_sop args={"query":"GPU Xid 79 错误处理"}
[tool-result] name=search_sop isError=false ...
[verification] toolCallCount=1
```

## 验证与构建

执行类型检查：

```powershell
npm test
```

编译并运行 JavaScript 产物：

```powershell
npm run build
node dist/index.js "GPU 报错 Xid 79，应该怎么处理？"
```

## 目录结构

```text
OnCall/
├─ src/
│  ├─ agent/
│  │  ├─ ops-agent.ts          # 组装模型、提示词和已启用工具
│  │  └─ system-prompt.ts      # OnCall Agent 系统提示词
│  ├─ data-sources/
│  │  ├─ disk-inspection-source.ts # 磁盘数据源接口和返回类型
│  │  └─ sop-source.ts             # SOP 数据源接口和返回类型
│  ├─ mocks/
│  │  ├─ mock-disk-inspection-source.ts # 首个磁盘事件的固定数据
│  │  └─ mock-sop-source.ts             # 固定 SOP 数据
│  ├─ tools/
│  │  ├─ search-sop.ts         # SOP Tool 与数据源调用
│  │  ├─ inspect-disk.ts       # 磁盘使用率 Tool 与数据源调用
│  │  └─ inspect-directory.ts  # 大目录 Tool 与数据源调用
│  ├─ rag/
│  │  ├─ retriever.ts          # 规划中：SOP 检索接口
│  │  └─ embedder.ts           # 规划中：文本向量化接口
│  └─ index.ts                 # CLI 启动、环境检查和事件输出
├─ .env.example                # 环境变量模板
├─ .gitignore                  # Git 忽略规则
├─ package.json                # 依赖与命令
└─ tsconfig.json               # TypeScript 配置
```

`src/index.ts` 是当前组合入口：它把 Mock 数据源注入 Agent。后续接入真实场景时，实现相同的数据源接口，并在入口处替换注入对象即可；工具名称、参数和返回结构不需要改变。RAG 文件仍仅建立了代码边界，尚无运行实现。
