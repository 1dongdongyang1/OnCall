# OnCall Agent

一个面向值班与故障响应场景的 TypeScript Agent。项目使用 DeepSeek 理解故障问题，通过 Pi Agent 完成模型调用、Tool Calling 和消息循环，并调用受控工具查询 SOP 后生成处置建议。

## 项目目标

OnCall Agent 的目标是把“故障描述 → 收集只读证据 → 输出有依据的判断”串成一条可观察、可验证的处理链路。

首个磁盘告警事件使用 `node-01` 的固定 Mock 数据跑通以下链路：

```text
node-01 磁盘使用率 > 90%
  → get_disk_usage(node-01)：/=95%
  → list_large_directories(node-01, "/")：/var=72G
  → list_large_directories(node-01, "/var")：/var/log=65G
  → 判断日志异常增长，需要进一步确认日志类型
```

## 当前能力

- 使用 `deepseek-v4-flash` 进行真实模型推理。
- 使用 `@earendil-works/pi-agent-core` 管理 Agent 循环和工具调用。
- 提供只读的 `search_sop`、`get_disk_usage` 和 `list_large_directories` 工具。
- 磁盘工具通过数据源接口获取结果，当前注入按节点组织的独立 Mock 数据源。
- `search_sop` 当前读取 `sops/*.md` 并按文档元数据中的关键词匹配。
- 支持 GPU Xid 79 和 GPU 温度过高两份 Markdown SOP。
- 支持磁盘根分区使用率过高的首个固定诊断事件。
- 输出工具名、调用参数、执行结果和调用次数，便于验证 Tool Calling。
- 通过 `.env` 管理 DeepSeek API Key。

## 当前边界

- 程序入口目前为机器检查工具注入 Mock 数据源，不会读取真实节点。
- SOP 检索当前是简单关键词包含匹配，还没有语义召回、排序或向量数据库。
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
npm start -- "节点 node-01 告警：磁盘使用率超过 90%，请定位原因"
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
│  │  ├─ markdown-sop-source.ts     # Markdown 加载、解析和关键词检索
│  │  └─ sop-source.ts             # SOP 数据源接口和返回类型
│  ├─ mocks/
│  │  ├─ mock-disk-inspection-source.ts # 首个磁盘事件的固定数据
│  ├─ tools/
│  │  ├─ search-sop.ts         # SOP Tool 与数据源调用
│  │  ├─ inspect-disk.ts       # 磁盘使用率 Tool 与数据源调用
│  │  └─ inspect-directory.ts  # 大目录 Tool 与数据源调用
│  ├─ rag/
│  │  ├─ retriever.ts          # 规划中：SOP 检索接口
│  │  └─ embedder.ts           # 规划中：文本向量化接口
│  └─ index.ts                 # CLI 启动、环境检查和事件输出
├─ sops/                       # Markdown SOP 文档
│  ├─ gpu-overheat.md
│  └─ gpu-xid-79.md
├─ .env.example                # 环境变量模板
├─ .gitignore                  # Git 忽略规则
├─ package.json                # 依赖与命令
└─ tsconfig.json               # TypeScript 配置
```

`src/index.ts` 是当前组合入口：它把按节点组织的 Mock 磁盘数据源和 Markdown SOP 数据源注入 Agent。后续接入真实机器时，实现 `DiskInspectionSource` 并替换注入对象；接入向量数据库时，实现 `SopSource` 并替换 `MarkdownSopSource`。工具名称和 Agent 组装逻辑不需要重写。RAG 文件仍仅建立了代码边界，尚无运行实现。
