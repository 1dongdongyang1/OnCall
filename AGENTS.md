# 仓库协作规范

## 项目结构与模块职责

应用代码位于 `src/`。`src/index.ts` 负责加载配置、创建 Agent 和输出运行事件。Agent 的组装代码放在 `src/agent/`：模型与工具注册维护在 `ops-agent.ts`，行为约束维护在 `system-prompt.ts`。

工具实现放在 `src/tools/`，每个工具单独一个 kebab-case 文件，例如 `search-sop.ts`。外部数据访问契约放在 `src/data-sources/`，固定测试数据放在 `src/mocks/`。统一 Chunk 构建、检索索引、评测集与评测程序放在 `src/rag/`。SOP 原始文档放在 `sops/`，当前包含 CPU、内存、磁盘、服务不可用和响应时间过长五类文档；不得为适配代码而修改用户提供的 SOP 内容。

测试文件采用 `*.test.ts`，放在被测模块附近。真实大模型的 Agent 验收测试采用 `*.acceptance.test.ts`，必须通过独立命令显式运行。`dist/` 和 `.rag-index/` 都是生成目录，不得手工编辑或提交。

## 安装、运行与验证命令

- `npm ci`：按 `package-lock.json` 安装精确版本依赖。
- `npm start -- "node-01 根分区磁盘使用率超过90%，请排查并说明处理建议"`：使用输入提示运行 TypeScript CLI。
- `npm run typecheck`：只做 TypeScript 类型检查，不生成文件。
- `npm test`：运行类型检查、DataSource Mock、运行时预算/去重/超时负向测试和离线检索测试，不调用付费大模型。
- `npm run test:runtime`：只运行运行时预算、去重、Agent/模型/工具超时、模型轮数、`isError`、usage 与安全终止测试，使用内存 Faux 模型，不调用付费大模型。
- `npm run test:data-source`：只运行 DataSource 层 Mock 测试。
- `npm run test:retrieval`：验证统一 Chunk、稳定 ID、Top-K、三套索引元数据和可重复构建。
- `npm run test:agent:acceptance`：使用真实 DeepSeek 运行 Agent 集成验收，可能产生 API 费用。
- `npm run build:rag-index`：从当前 `sops/` 生成统一 Chunk 数据，并构建 Keyword 与 TF-IDF 索引，同时报告 Chunk 的新增、删除、未变化和发生变化的标题位置。
- `npm run build:embedding-index`：从同一 Chunk 数据调用真实 Embedding 模型并构建本地向量索引。
- `npm run eval:retrieval`：重建索引并实际比较 Keyword、TF-IDF、Embedding 的 Recall@1、Recall@3 和 No-match accuracy。
- `npm run build`：把 `src/` 编译到 `dist/`。
- `node dist/index.js "prompt"`：运行编译后的程序。

提交改动前至少运行 `npm test`、`npm run build` 和 `git diff --check`。涉及 Agent 行为时还要显式运行 `npm run test:agent:acceptance`；涉及检索、SOP 或索引时还要运行 `npm run eval:retrieval`。

## 编码风格与命名

使用严格模式 TypeScript、ES Modules、两个空格缩进、分号和双引号。变量与函数使用 `camelCase`，类型使用 `PascalCase`，导出的常量使用 `UPPER_SNAKE_CASE`，文件名使用 kebab-case。

项目使用 `NodeNext`，相对导入路径必须保留 `.js` 扩展名。当前没有配置格式化器或 Linter，修改时应与周围代码保持一致。不要直接修改编译生成的 JavaScript。

## 测试分层与验收原则

测试必须明确区分以下层次：

1. DataSource 层测试只验证接口实现和固定 Mock 数据，不创建 Agent、不调用大模型。
2. 检索测试验证统一 Chunk、稳定身份、Top-K 接口、排序、元数据保留、no-match 行为和索引可重复构建。
3. Agent 集成测试注入受控 Mock DataSource，但使用真实大模型验证完整工具调用与回答行为，不能加入默认 `npm test`。

运行时控制测试必须使用内存模型和可中止的受控工具，分别验证工具请求数与实际执行数、模型轮数与模型请求数、明确终止原因，以及 usage 缺失时返回 `unavailable`。重复调用、预算耗尽、工具异常或超时后不得再让模型补写未经证实的结论。

Agent 验收应验证关键行为和安全约束，不得锁死模型的完整思考路线或固定整段调用数组。至少核对：工具名与参数、节点边界、必要证据、因果前置条件、重复调用、调用预算、`isError`、工具返回证据和最终回答。不能把看似合理的模型文字当作工具已经执行的证明。

检索评测集中的每条正样本必须包含查询、预期文档、预期证据和明确判定规则；no-match 样本必须明确预期返回空结果。Keyword、TF-IDF 和 Embedding 检索必须使用同一语料与同一评测集。Recall@K 和 No-match accuracy 必须由评测命令现场计算，禁止把预设数值或历史结果写进 README。

三套检索索引必须消费同一份持久化 `sop-chunks.json`，禁止各自直接读取和切分 SOP。当前统一分块策略按 Markdown 标题与段落组织，每个 Chunk 最多 1400 个字符；解析标题时必须识别 fenced code block，代码块内以 `#` 开头的 shell 注释不能成为标题。

`documentId` 由规范化后的一级标题生成 SHA-256，不能直接使用文件名；`chunkId` 由 `documentId`、完整标题路径和 Chunk 内容哈希生成，不能依赖数组下标。`sourcePath` 只用于来源追踪，不参与身份计算。索引必须保留 `documentId`、`chunkId`、文档标题、标题路径、内容哈希和 `sourcePath`。重新构建时应通过 Chunk ID 和稳定标题位置区分新增、删除、未变化及内容变化；文件改名不能改变文档或未变 Chunk 的 ID。

Keyword 使用基于统一 Chunk 的倒排索引，TF-IDF 与 Chunk 数据要保证相同语料可以重复构建出一致结果；Embedding 索引还必须记录模型 ID、固定 revision 和向量维度。第一版默认 Top-3；修改分块、分词、模型、权重或拒识阈值时，必须同时观察 Recall@1、Recall@3 和 No-match accuracy，不能只优化单一指标。

## 提交与 Pull Request

现有提交使用简短的祈使句摘要，例如 `Add SOP search tool`。新提交应保持同样风格并聚焦单一主题。

Pull Request 应说明行为变化、列出实际运行的验证命令、关联相关 Issue，并为 Agent 或工具变化附上有代表性的 CLI 输出。检索改动应报告本次真实评测结果，但不要把结果固化为 README 中的常量。

## 安全与 Agent 边界

密钥只能保存在 `.env` 中；`.env.example` 只提交占位值。禁止记录或输出 API Key。

机器检查工具默认只读，只注册已经实现的工具，并明确标记 Mock 数据。Agent 不得猜测节点、文件、根因或未返回的 SOP 步骤。数据源标记为“未提供”的信息只能列为待确认事项，不能据此断定配置缺失、配置失效、场景高度吻合或排除未检查的故障场景；较小但未继续检查的条目也不能直接称为正常。

SOP 是参考证据，不是执行授权。即使检索到的 Chunk 包含删除、清空、截断、重启、扩容等命令，Agent 也不得执行、复述或建议用户直接运行这些命令；只能说明必要的业务确认、备份、审批、限定范围和操作后验证。

任何执行修复、删除、清理、重启或隔离等变更操作的能力，都必须取得明确授权、限制输入范围，并返回可审计结果。没有授权时只能输出证据、判断、待确认事项和安全处置建议。
