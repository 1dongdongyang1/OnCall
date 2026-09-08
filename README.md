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
  → list_large_directories(node-01, "/var/log")：app.log=61G
  → inspect_file(node-01, "/var/log/app.log")：确认文件仍在写入
  → search_sop("磁盘使用率过高")
  → 输出证据、判断、待确认事项和安全处置建议
```

## 当前能力

- 使用 `deepseek-v4-flash` 进行真实模型推理。
- 使用 `@earendil-works/pi-agent-core` 管理 Agent 循环和工具调用。
- 提供只读的 `search_sop`、`get_disk_usage`、`list_large_directories` 和 `inspect_file` 工具。
- 磁盘工具通过数据源接口获取结果，当前注入按节点组织的独立 Mock 数据源。
- `search_sop` 使用统一 Top-K 接口，第一版默认返回 Top-3。
- 所有 Markdown SOP 先经过同一套标题感知分块，生成统一 Chunk 数据；Keyword、TF-IDF、Embedding 三套索引只消费该数据。
- Agent 已使用本地 TF-IDF 检索 SOP；索引以 JSON 保存 Chunk 元数据，并在启动时从当前 SOP 可重复构建。
- 文档 ID 由顶级标题生成，Chunk ID 由文档 ID、标题路径和内容哈希生成，不依赖文件名或数组下标。
- 提供真正的多语言 Embedding 模型实现，以本地 JSON 保存 Chunk 向量并使用余弦相似度检索。
- 提供包含预期文档、预期证据和判定规则的检索评测集，可比较 Keyword、TF-IDF、Embedding 三种检索的 Recall@K 与 no-match accuracy。
- 当前语料包含 CPU、内存、磁盘、服务不可用和响应时间过长五类 Markdown SOP。
- 支持磁盘根分区使用率过高的首个固定诊断事件。
- 输出工具名、调用参数、执行结果和调用次数，便于验证 Tool Calling。
- 通过 `.env` 管理 DeepSeek API Key。

## 当前边界

- 程序入口目前为机器检查工具注入 Mock 数据源，不会读取真实节点。
- Agent 运行入口当前注入 TF-IDF 检索；Embedding 检索先保留为离线对比项，尚未切换到 Agent，也未增加混合检索或重排。
- 当前只输出诊断与处置建议，不会执行重启、隔离节点等变更操作。
- 尚未接入监控告警、CMDB、工单系统或会话持久化。
- `npm test` 运行类型检查、DataSource Mock 和离线检索测试，不会调用真实大模型或下载 Embedding 模型。

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

手工运行首个磁盘告警事件（真实模型 + Mock DataSource）：

```powershell
npm start -- "node-01 根分区磁盘使用率超过90%，请排查并说明处理建议。"
```

成功调用工具时，终端会输出类似记录：

```text
[tool-call] name=search_sop args={"query":"GPU Xid 79 错误处理"}
[tool-result] name=search_sop isError=false ...
[verification] toolCallCount=1
```

## 验证与构建

验证分为三层：

- DataSource 层测试：只运行固定 Mock，不调用大模型、不产生 API 费用；默认 `npm test` 会运行这一层。
- 检索测试与评测：验证 Top-K、元数据和索引可重复构建，并从评测集实际计算检索指标；不调用大模型。
- Agent 集成测试：注入同一个 Mock DataSource，但运行真实 DeepSeek，验证关键诊断行为、工具错误、安全边界和最终回答，不锁死完整调用路线；需要显式运行。

执行默认测试（类型检查 + DataSource Mock + 离线检索测试）：

```powershell
npm test
```

只运行 DataSource Mock 测试：

```powershell
npm run test:data-source
```

构建统一 Chunk 数据以及 Keyword、TF-IDF 索引，或基于同一 Chunk 数据构建 Embedding 索引：

```powershell
npm run build:rag-index
npm run build:embedding-index
```

运行检索评测。命令会先从当前 `sops/` 生成一份统一 Chunk 数据，再据此重建 Keyword、TF-IDF、Embedding 三套索引并计算指标；README 不保存预计算结果。首次运行会下载并缓存固定 revision 的多语言 Embedding 模型：

```powershell
npm run eval:retrieval
```

需要查看每条查询的实际排名和分数时：

```powershell
npx tsx src/rag/evaluate-retrieval.ts --details
```

显式运行第一个真实模型验收场景：

```powershell
npm run test:agent:acceptance
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
│  │  ├─ disk-inspection-source.test.ts # DataSource Mock 测试
│  │  └─ sop-source.ts             # SOP 数据源接口和返回类型
│  ├─ mocks/
│  │  ├─ mock-disk-inspection-source.ts # 首个磁盘事件的固定数据
│  ├─ tools/
│  │  ├─ search-sop.ts         # SOP Tool 与数据源调用
│  │  ├─ inspect-disk.ts       # 磁盘使用率 Tool 与数据源调用
│  │  ├─ inspect-directory.ts  # 大目录 Tool 与数据源调用
│  │  └─ inspect-file.ts       # 具体文件只读检查 Tool
│  ├─ rag/
│  │  ├─ retriever.ts          # 通用 Top-K 检索结果契约
│  │  ├─ chunk-store.ts        # Markdown → 稳定 ID 的统一 Chunk 数据
│  │  ├─ text-tokenizer.ts     # Keyword 与 TF-IDF 共用分词
│  │  ├─ embedder.ts           # Embedder 抽象与多语言模型实现
│  │  ├─ local-keyword-index.ts # Chunk 级关键词倒排索引
│  │  ├─ local-tfidf-index.ts  # 可重复构建的本地 TF-IDF JSON 索引
│  │  ├─ local-embedding-index.ts # Embedding JSON 索引与余弦检索
│  │  ├─ build-tfidf-index.ts  # 单独构建 TF-IDF 索引
│  │  ├─ build-embedding-index.ts # 单独构建 Embedding 索引
│  │  ├─ retrieval-eval-cases.json # 检索评测集与判定规则
│  │  ├─ evaluate-retrieval.ts # 三种检索的 Recall@K 评测
│  │  └─ retrieval.test.ts     # Top-K、元数据与重复构建测试
│  └─ index.ts                 # CLI 启动、环境检查和事件输出
├─ sops/                       # Markdown SOP 文档
│  ├─ cpu_high_usage.md
│  ├─ disk_high_usage.md
│  ├─ memory_high_usage.md
│  ├─ service_unavailable.md
│  └─ slow_response.md
├─ .env.example                # 环境变量模板
├─ .gitignore                  # Git 忽略规则
├─ package.json                # 依赖与命令
└─ tsconfig.json               # TypeScript 配置
```

`src/index.ts` 是当前组合入口：它先生成统一 Chunk 数据和 TF-IDF 索引，再把按节点组织的 Mock 磁盘数据源和 `LocalTfidfSopSource` 注入 Agent。后续接入真实机器时，实现 `DiskInspectionSource` 并替换注入对象；若评测证明需要切换 Embedding 或混合检索，只需替换统一 Top-K `SopSource` 的注入，工具名称和 Agent 组装逻辑不需要重写。
