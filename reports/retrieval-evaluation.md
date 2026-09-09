# 统一 Chunk 检索评测报告

- 生成时间：2026-09-09T02:14:30.757Z
- Node.js：v22.14.0
- 语料：5 documents / 104 chunks
- ChunkStore SHA-256：`403239181cdfbcd28a9d02bd3c00ec57a910f87440b8d14b0ad8897329feafa1`
- 评测集 SHA-256：`bfe64c73f167e2a2042d34402f1b63c7e826d304a570e1f9957223385dbe3847`
- Embedding：`Xenova/paraphrase-multilingual-MiniLM-L12-v2@2c4055b12046f11709e9df2c122e59ffbdc2f900`，384 dimensions
- Top-K：3
- 复现命令：`npm ci && npm run eval:retrieval`

## 汇总指标

| 检索器 | 阈值 | Document R@1 | Document R@3 | Evidence Chunk R@1 | Evidence Chunk R@3 | No-match accuracy | 平均耗时 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Keyword Retrieval | 10 | 86.96% | 91.30% | 82.61% | 84.78% | 80.00% | 4.08 ms/query |
| TF-IDF Retrieval | 0.2 | 91.30% | 95.65% | 78.26% | 84.78% | 80.00% | 8.51 ms/query |
| Embedding Retrieval | 0.42 | 78.26% | 86.96% | 56.52% | 63.04% | 80.00% | 7.11 ms/query |

## 失败案例汇总

### Keyword Retrieval

- Document Recall@1 未满：memory-colloquial-leak, slow-colloquial-p99, slow-sql-n-plus-one
- Document Recall@3 未满：memory-colloquial-leak, slow-colloquial-p99
- Evidence Chunk Recall@1 未满：disk-step-inode, memory-colloquial-leak, slow-colloquial-p99, slow-sql-n-plus-one
- Evidence Chunk Recall@3 未满：disk-step-inode, memory-colloquial-leak, slow-colloquial-p99, slow-sql-n-plus-one
- no-match 误召回：no-match-kafka-lag

### TF-IDF Retrieval

- Document Recall@1 未满：slow-colloquial-p99, slow-sql-n-plus-one
- Document Recall@3 未满：slow-colloquial-p99
- Evidence Chunk Recall@1 未满：disk-step-inode, memory-colloquial-leak, service-colloquial-all-down, slow-colloquial-p99, slow-sql-n-plus-one
- Evidence Chunk Recall@3 未满：disk-step-inode, service-colloquial-all-down, slow-colloquial-p99, slow-sql-n-plus-one
- no-match 误召回：no-match-kubernetes-image

### Embedding Retrieval

- Document Recall@1 未满：disk-colloquial-growing-log, disk-docker-resources, service-colloquial-all-down, slow-sql-n-plus-one, slow-step-system-resources
- Document Recall@3 未满：disk-docker-resources, service-colloquial-all-down, slow-step-system-resources
- Evidence Chunk Recall@1 未满：cpu-step-system-logs, disk-colloquial-growing-log, disk-step-inode, disk-docker-resources, memory-colloquial-leak, service-colloquial-all-down, service-step-dependencies, service-similar-oom-outage, slow-sql-n-plus-one, slow-step-system-resources
- Evidence Chunk Recall@3 未满：cpu-step-system-logs, disk-colloquial-growing-log, disk-step-inode, disk-docker-resources, memory-colloquial-leak, service-colloquial-all-down, service-similar-oom-outage, slow-sql-n-plus-one, slow-step-system-resources
- no-match 误召回：no-match-ntp

## 失败分析与下一步判定

- 三套检索共同未完整召回的证据样本：disk-step-inode, slow-sql-n-plus-one。共同失败不能靠简单合并候选解决，应优先检查查询与同文档内证据定位、多证据覆盖能力。
- 存在互补命中的证据样本：cpu-step-system-logs（命中：Keyword/TF-IDF；未满：Embedding）；disk-colloquial-growing-log（命中：Keyword/TF-IDF；未满：Embedding）；disk-docker-resources（命中：Keyword/TF-IDF；未满：Embedding）；memory-colloquial-leak（命中：TF-IDF；未满：Keyword/Embedding）；service-colloquial-all-down（命中：Keyword；未满：TF-IDF/Embedding）；service-similar-oom-outage（命中：Keyword/TF-IDF；未满：Embedding）；slow-colloquial-p99（命中：Embedding；未满：Keyword/TF-IDF）；slow-step-system-resources（命中：Keyword/TF-IDF；未满：Embedding）。这说明词法与语义候选有互补性，但不代表任意融合都会改善拒识。
- 三套检索的 no-match 误召回分别为：Keyword=[no-match-kafka-lag]；TF-IDF=[no-match-kubernetes-image]；Embedding=[no-match-ntp]。误召回样本并不相同，后续实验必须保留独立拒识阈值验证。
- `disk-step-inode` 的三套结果都命中了磁盘文档或相关 inode Chunk，却没有定位到包含 `df -i` 的命令 Chunk；这是证据定位失败，不是文档召回失败。
- `slow-sql-n-plus-one` 的三套 Top-3 都只覆盖了两个预期 Chunk 中的慢查询原因，没有同时覆盖 N+1 检查清单；这是多证据覆盖失败。
- 基于互补样本，可以进入下一轮简单混合检索实验：只比较 Keyword/TF-IDF 与 Embedding 的候选并集或 RRF，并继续以同一评测集验证 Chunk Recall 与 no-match。本次不实现融合或重排。
- 耗时是本机单次运行的现场值，受首次模型推理、缓存与机器负载影响；语料哈希、评测集哈希和固定模型 revision 用于复现实验输入，不保证不同机器耗时相同。

## 逐条 Top-K

### Keyword Retrieval

#### cpu-alert-original

- 分类：alert-original
- 查询：HighCPUUsage：CPU使用率连续5分钟超过80%
- 预期证据：HighCPUUsage 的名称和连续5分钟超过80%的触发条件。
- 判定规则：Top-K 必须命中 CPU 告警名称 Chunk。
- 耗时：10.68 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-094dcba6890817ca95611e6b | 37.000000 | yes | yes | CPU使用率过高告警处理方案 > 告警名称 |
| 2 | doc-05acb1a777e3f2d26770 | chunk-4405153dab2f5f08a0983d03 | 22.000000 | no | no | 磁盘使用率过高告警处理方案 > 告警名称 |
| 3 | doc-184fe84cc86bdb9910db | chunk-ae5a8f64f2b230f136390f71 | 22.000000 | no | no | 内存使用率过高告警处理方案 > 相关告警 |

#### cpu-colloquial-hot-process

- 分类：colloquial
- 查询：机器突然很卡，有个进程快把一个核吃满了，错误堆栈还一直刷
- 预期证据：单进程 CPU 接近100%和重复错误堆栈对应死循环或无限递归。
- 判定规则：Top-K 必须命中 CPU SOP 的死循环或无限递归 Chunk。
- 耗时：5.31 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-3e5314485beed7f55e5c5e4b | 21.000000 | yes | yes | CPU使用率过高告警处理方案 > 常见原因分析 > 原因1: 死循环或无限递归 |

#### cpu-cron-overlap

- 分类：similar-sop
- 查询：负载只在固定时间冲高，怀疑两个定时任务撞在一起执行
- 预期证据：定时任务重叠执行的周期性特征、错峰与互斥锁建议。
- 判定规则：Top-K 必须命中 CPU SOP 的定时任务重叠 Chunk，而非泛化到慢响应 SOP。
- 耗时：3.82 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-38dd1ad77f3a34a17bf994ad | 19.000000 | yes | yes | CPU使用率过高告警处理方案 > 常见原因分析 > 原因3: 定时任务重叠执行 |
| 2 | doc-184fe84cc86bdb9910db | chunk-def20c38a31d4d407c25109c | 17.000000 | no | no | 内存使用率过高告警处理方案 > 常见原因分析 > 原因4: 大文件或大数据处理 |
| 3 | doc-05acb1a777e3f2d26770 | chunk-abcb8267e156fb6ff34b8d37 | 12.000000 | no | no | 磁盘使用率过高告警处理方案 > 常见原因分析 > 原因2: 临时文件堆积 |

#### cpu-step-system-logs

- 分类：troubleshooting-step
- 查询：CPU告警后查 system-metrics 时地域、时间范围和查询条件是什么
- 预期证据：CPU SOP 查询 system-metrics 的地域、最近30分钟和 cpu_usage 条件。
- 判定规则：Top-K 必须命中 CPU 排查步骤2的系统日志查询 Chunk。
- 耗时：3.28 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-692b536f3f8f15e683874839 | 44.000000 | yes | yes | CPU使用率过高告警处理方案 > 排查步骤 > 步骤2: 查询系统日志 |
| 2 | doc-184fe84cc86bdb9910db | chunk-19694e21dd2e9e1221822595 | 41.000000 | no | no | 内存使用率过高告警处理方案 > 排查步骤 > 步骤2: 查询系统监控日志 |
| 3 | doc-05acb1a777e3f2d26770 | chunk-fd48b59be22c38a259753bf5 | 41.000000 | no | no | 磁盘使用率过高告警处理方案 > 排查步骤 > 步骤2: 查询系统磁盘使用情况 |

#### disk-alert-original

- 分类：alert-original
- 查询：HighDiskUsage 严重告警，磁盘使用率持续5分钟超过90%
- 预期证据：HighDiskUsage 告警名、80%警告和90%严重阈值。
- 判定规则：Top-K 必须命中磁盘告警名称 Chunk。
- 耗时：3.06 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-4405153dab2f5f08a0983d03 | 57.000000 | yes | yes | 磁盘使用率过高告警处理方案 > 告警名称 |
| 2 | doc-11fb79358af9ffa4cc6e | chunk-094dcba6890817ca95611e6b | 32.000000 | no | no | CPU使用率过高告警处理方案 > 告警名称 |
| 3 | doc-184fe84cc86bdb9910db | chunk-3ec307e6af9b7a7db852c7c4 | 32.000000 | no | no | 内存使用率过高告警处理方案 > 告警名称 |

#### disk-colloquial-growing-log

- 分类：colloquial
- 查询：根盘快爆了，var log 里的应用日志还在不停变大
- 预期证据：/var/log 占用大且应用日志持续增长的日志文件过大场景。
- 判定规则：Top-K 必须命中磁盘 SOP 的日志文件过大 Chunk。
- 耗时：3.34 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-1ca4616f69b2013496845e44 | 18.000000 | yes | yes | 磁盘使用率过高告警处理方案 > 常见原因分析 > 原因1: 日志文件过大 |
| 2 | doc-11fb79358af9ffa4cc6e | chunk-3e5314485beed7f55e5c5e4b | 12.000000 | no | no | CPU使用率过高告警处理方案 > 常见原因分析 > 原因1: 死循环或无限递归 |
| 3 | doc-05acb1a777e3f2d26770 | chunk-4de99d058815ff3c5429b8a2 | 12.000000 | yes | no | 磁盘使用率过高告警处理方案 > 排查步骤 > 步骤3: 查询应用日志 |

#### disk-step-inode

- 分类：troubleshooting-step
- 查询：文件系统 inode 快耗尽，应该用什么命令检查
- 预期证据：使用 df -i 查看 inode 使用情况。
- 判定规则：Top-K 必须命中磁盘常用命令中的 inode 检查 Chunk。
- 耗时：3.49 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-38b259a2d306f8bfddff1119 | 19.000000 | yes | no | 磁盘使用率过高告警处理方案 > 相关告警 |

#### disk-docker-resources

- 分类：similar-sop
- 查询：Docker 未使用镜像、停止容器和容器日志把磁盘占满
- 预期证据：Docker 镜像、停止容器、卷和容器日志占用的排查内容。
- 判定规则：Top-K 必须命中磁盘 SOP 的 Docker 资源 Chunk。
- 耗时：3.38 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-0271f108b934bc30a72a72db | 36.000000 | yes | yes | 磁盘使用率过高告警处理方案 > 常见原因分析 > 原因6: Docker镜像和容器占用 |
| 2 | doc-05acb1a777e3f2d26770 | chunk-aa4f672093148fbe13e47eed | 11.000000 | yes | no | 磁盘使用率过高告警处理方案 > 排查步骤 > 步骤4: 分析磁盘占用 |
| 3 | doc-05acb1a777e3f2d26770 | chunk-44378b92d8bff3eed9770780 | 10.000000 | yes | no | 磁盘使用率过高告警处理方案 > 常见原因分析 > 原因5: 应用缓存文件过多 |

#### disk-step-largest-path

- 分类：troubleshooting-step
- 查询：磁盘满了以后怎样判断是哪个目录、日志还是数据文件增长
- 预期证据：分析最大目录、日志大小、临时文件数量和数据增长趋势。
- 判定规则：Top-K 必须命中磁盘排查步骤4的占用分析 Chunk。
- 耗时：3.05 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-aa4f672093148fbe13e47eed | 38.000000 | yes | yes | 磁盘使用率过高告警处理方案 > 排查步骤 > 步骤4: 分析磁盘占用 |
| 2 | doc-05acb1a777e3f2d26770 | chunk-465784fd5987c9e993a20490 | 24.000000 | yes | no | 磁盘使用率过高告警处理方案 > 常见原因分析 > 原因3: 数据文件增长过快 |
| 3 | doc-05acb1a777e3f2d26770 | chunk-cd4660d3c42222d7fc2fafa9 | 13.000000 | yes | no | 磁盘使用率过高告警处理方案 > 紧急处理措施 > 立即操作（5分钟内） |

#### memory-alert-original

- 分类：alert-original
- 查询：HighMemoryUsage：内存使用率持续5分钟超过85%
- 预期证据：HighMemoryUsage 名称和持续5分钟超过85%的触发条件。
- 判定规则：Top-K 必须命中内存告警名称 Chunk。
- 耗时：3.46 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-184fe84cc86bdb9910db | chunk-3ec307e6af9b7a7db852c7c4 | 55.000000 | yes | yes | 内存使用率过高告警处理方案 > 告警名称 |
| 2 | doc-5d98b18e456ad5b295cf | chunk-d6216882a15e6eaff6c2f709 | 32.000000 | no | no | 服务响应时间过长告警处理方案 > 相关告警 |
| 3 | doc-11fb79358af9ffa4cc6e | chunk-e024f4dd7fc7f37eca96ca50 | 32.000000 | no | no | CPU使用率过高告警处理方案 > 相关告警 |

#### memory-colloquial-leak

- 分类：colloquial
- 查询：服务跑得越久越吃内存，Full GC 之后也降不下来
- 预期证据：内存持续缓慢上升且 Full GC 后无法释放的泄漏特征。
- 判定规则：Top-K 必须命中内存泄漏 Chunk。
- 耗时：8.33 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |
#### memory-step-oom-logs

- 分类：troubleshooting-step
- 查询：应用出现 OutOfMemoryError 和 GC overhead，要查哪类应用日志
- 预期证据：application-logs 中查询 OutOfMemoryError 或 GC overhead。
- 判定规则：Top-K 必须命中内存排查步骤3的应用日志查询 Chunk。
- 耗时：3.83 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-184fe84cc86bdb9910db | chunk-c194952690f4748757d10da1 | 38.000000 | yes | yes | 内存使用率过高告警处理方案 > 排查步骤 > 步骤3: 查询应用日志 |
| 2 | doc-184fe84cc86bdb9910db | chunk-7824310161dffd13362f1d43 | 14.000000 | yes | no | 内存使用率过高告警处理方案 > 常见原因分析 > 原因2: 流量突增导致对象激增 |
| 3 | doc-184fe84cc86bdb9910db | chunk-d161d2b5ad551f87fea90221 | 14.000000 | yes | no | 内存使用率过高告警处理方案 > 验证步骤 |

#### memory-step-jmap-dump

- 分类：troubleshooting-step
- 查询：怎样用 jmap 生成 heap.hprof 堆快照
- 预期证据：jmap -dump:format=b,file=heap.hprof 命令。
- 判定规则：Top-K 必须命中生成堆转储文件 Chunk。
- 耗时：2.85 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-184fe84cc86bdb9910db | chunk-6bd767e4e4646f198324f493 | 15.000000 | yes | yes | 内存使用率过高告警处理方案 > 相关工具命令 > 生成堆转储文件 |

#### service-alert-original

- 分类：alert-original
- 查询：ServiceUnavailable：健康检查失败或错误率超过50%
- 预期证据：ServiceUnavailable 名称、健康检查失败和错误率超过50%的条件。
- 判定规则：Top-K 必须命中服务不可用告警名称 Chunk。
- 耗时：2.77 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-4725225aba6d608a1b83917b | 72.000000 | yes | yes | 服务不可用告警处理方案 > 告警名称 |
| 2 | doc-8a0cb13b4f7374ce31cc | chunk-964f366a99e29953dd7dbe9c | 29.000000 | yes | no | 服务不可用告警处理方案 > 相关告警 |
| 3 | doc-8a0cb13b4f7374ce31cc | chunk-a0b870df6946b209af630350 | 19.000000 | yes | no | 服务不可用告警处理方案 > 验证步骤 |

#### service-colloquial-all-down

- 分类：colloquial
- 查询：接口全挂了，健康检查一片红，用户完全进不去
- 预期证据：所有实例无法响应且健康检查全部失败的应用崩溃场景。
- 判定规则：Top-K 必须命中服务不可用 SOP 的应用崩溃 Chunk。
- 耗时：2.91 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-7396881d68063b860624abd2 | 14.000000 | yes | yes | 服务不可用告警处理方案 > 常见原因分析 > 原因1: 应用崩溃或无法启动 |
| 2 | doc-8a0cb13b4f7374ce31cc | chunk-20f383bc3221d97440af63a3 | 12.000000 | yes | no | 服务不可用告警处理方案 > 预防措施 |
| 3 | doc-8a0cb13b4f7374ce31cc | chunk-4725225aba6d608a1b83917b | 12.000000 | yes | no | 服务不可用告警处理方案 > 告警名称 |

#### service-step-dependencies

- 分类：troubleshooting-step
- 查询：服务不可用时怎样检查 database、redis 和 mq 下游依赖
- 预期证据：查询 application-logs 中 downstream_service、database、redis、mq。
- 判定规则：Top-K 必须命中检查依赖服务状态的排查步骤 Chunk。
- 耗时：3.21 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-899ad13f1d5f233d082b68bb | 36.000000 | yes | yes | 服务不可用告警处理方案 > 排查步骤 > 步骤4: 检查依赖服务状态 |
| 2 | doc-8a0cb13b4f7374ce31cc | chunk-8ab848f917d940342b53e027 | 28.000000 | yes | no | 服务不可用告警处理方案 > 常见原因分析 > 原因3: 依赖服务故障 |
| 3 | doc-8a0cb13b4f7374ce31cc | chunk-7396881d68063b860624abd2 | 21.000000 | yes | no | 服务不可用告警处理方案 > 常见原因分析 > 原因1: 应用崩溃或无法启动 |

#### service-release-rollback

- 分类：similar-sop
- 查询：新版本发布后所有实例都无法响应，需要回到上一个稳定版本
- 预期证据：新版本发布后全部故障时回滚稳定版本。
- 判定规则：Top-K 必须命中服务不可用 SOP 的应用崩溃与回滚 Chunk。
- 耗时：3.07 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-7396881d68063b860624abd2 | 89.000000 | yes | yes | 服务不可用告警处理方案 > 常见原因分析 > 原因1: 应用崩溃或无法启动 |
| 2 | doc-11fb79358af9ffa4cc6e | chunk-3e5314485beed7f55e5c5e4b | 34.000000 | no | no | CPU使用率过高告警处理方案 > 常见原因分析 > 原因1: 死循环或无限递归 |
| 3 | doc-8a0cb13b4f7374ce31cc | chunk-a0b870df6946b209af630350 | 16.000000 | yes | no | 服务不可用告警处理方案 > 验证步骤 |

#### service-similar-oom-outage

- 分类：similar-sop
- 查询：服务已经不可用，同时机器内存不足并出现 OOM，先查资源耗尽场景
- 预期证据：服务不可用 SOP 中资源耗尽包含内存不足导致 OOM。
- 判定规则：以服务不可用为主问题，Top-K 必须命中服务不可用的资源耗尽 Chunk，而不只命中内存 SOP。
- 耗时：3.19 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-b3922ff1100f13e5dde4ad13 | 36.000000 | yes | yes | 服务不可用告警处理方案 > 常见原因分析 > 原因5: 资源耗尽 |
| 2 | doc-8a0cb13b4f7374ce31cc | chunk-7396881d68063b860624abd2 | 14.000000 | yes | no | 服务不可用告警处理方案 > 常见原因分析 > 原因1: 应用崩溃或无法启动 |
| 3 | doc-8a0cb13b4f7374ce31cc | chunk-c0c6fdf98950ef7064d7197a | 12.000000 | yes | no | 服务不可用告警处理方案 > 排查步骤 > 步骤3: 查询系统事件日志 |

#### slow-alert-original

- 分类：alert-original
- 查询：SlowResponse：P99响应时间持续5分钟超过3秒
- 预期证据：SlowResponse 名称和 P99 持续5分钟超过3秒的触发条件。
- 判定规则：Top-K 必须命中慢响应告警名称 Chunk。
- 耗时：4.46 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-5d98b18e456ad5b295cf | chunk-4efc966828f5286791a9f177 | 50.000000 | yes | yes | 服务响应时间过长告警处理方案 > 告警名称 |
| 2 | doc-184fe84cc86bdb9910db | chunk-ae5a8f64f2b230f136390f71 | 24.000000 | no | no | 内存使用率过高告警处理方案 > 相关告警 |
| 3 | doc-11fb79358af9ffa4cc6e | chunk-e024f4dd7fc7f37eca96ca50 | 24.000000 | no | no | CPU使用率过高告警处理方案 > 相关告警 |

#### slow-colloquial-p99

- 分类：colloquial
- 查询：接口越来越慢，尾延迟已经三秒多，超时请求也变多了
- 预期证据：P99 超过3秒的慢响应告警。
- 判定规则：Top-K 必须命中慢响应告警 Chunk。
- 耗时：3.28 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### slow-sql-n-plus-one

- 分类：similar-sop
- 查询：接口慢，数据库有慢查询，而且代码可能存在 N+1 查询
- 预期证据：数据库慢查询原因分析以及 N+1 性能检查项。
- 判定规则：Top-3 应覆盖慢查询原因 Chunk 和含 N+1 的检查清单 Chunk。
- 耗时：5.48 ms
- Document R@1/R@3：0.00% / 100.00%
- Evidence Chunk R@1/R@3：0.00% / 50.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-29faa671b6d2702fb506caa0 | 20.000000 | no | no | CPU使用率过高告警处理方案 > 常见原因分析 > 原因4: 数据库查询慢 |
| 2 | doc-5d98b18e456ad5b295cf | chunk-3df7a052230e28d3bc2eb142 | 15.000000 | yes | yes | 服务响应时间过长告警处理方案 > 常见原因分析 > 原因1: 数据库慢查询 |
| 3 | doc-5d98b18e456ad5b295cf | chunk-750e6fed440a06b7e77ba296 | 14.000000 | yes | no | 服务响应时间过长告警处理方案 > 排查步骤 > 步骤3: 查询数据库慢查询日志 |

#### slow-external-api-timeout

- 分类：similar-sop
- 查询：第三方 API 响应很慢，HTTP 客户端还没有连接和读取超时
- 预期证据：外部 API 调用超时以及连接、读取超时设置。
- 判定规则：Top-K 必须命中慢响应 SOP 的外部 API 调用超时 Chunk。
- 耗时：3.46 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-5d98b18e456ad5b295cf | chunk-498af4258a2044d87be7c8f2 | 42.000000 | yes | yes | 服务响应时间过长告警处理方案 > 常见原因分析 > 原因2: 外部API调用超时 |
| 2 | doc-8a0cb13b4f7374ce31cc | chunk-8ab848f917d940342b53e027 | 13.000000 | no | no | 服务不可用告警处理方案 > 常见原因分析 > 原因3: 依赖服务故障 |

#### slow-step-system-resources

- 分类：troubleshooting-step
- 查询：响应时间过长时怎样同时查询 cpu、memory 和 disk io 指标
- 预期证据：慢响应排查步骤中查询 system-metrics 的 CPU、内存和磁盘 IO。
- 判定规则：Top-K 必须命中慢响应排查步骤4的系统资源查询 Chunk。
- 耗时：3.50 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-5d98b18e456ad5b295cf | chunk-61e29088586e6beeaa2c14e2 | 39.000000 | yes | yes | 服务响应时间过长告警处理方案 > 排查步骤 > 步骤4: 查询系统资源使用情况 |
| 2 | doc-5d98b18e456ad5b295cf | chunk-bbf822b689231719338bda59 | 31.000000 | yes | no | 服务响应时间过长告警处理方案 > 相关监控指标 |
| 3 | doc-5d98b18e456ad5b295cf | chunk-3df7a052230e28d3bc2eb142 | 27.000000 | yes | no | 服务响应时间过长告警处理方案 > 常见原因分析 > 原因1: 数据库慢查询 |

#### no-match-gpu-xid

- 分类：no-match
- 查询：GPU 出现 Xid 79 并从 PCIe 总线掉线
- 预期证据：当前五篇源文档没有 GPU Xid SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：4.05 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：正确

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### no-match-certificate

- 分类：no-match
- 查询：TLS 证书即将过期如何续签
- 预期证据：当前五篇源文档没有证书续签 SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：3.84 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：正确

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### no-match-ntp

- 分类：no-match
- 查询：NTP 时钟不同步导致服务器时间漂移
- 预期证据：当前五篇源文档没有 NTP SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：4.04 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：正确

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### no-match-kafka-lag

- 分类：no-match
- 查询：Kafka consumer group lag 持续增长，offset 提交失败
- 预期证据：当前五篇源文档没有 Kafka 消费积压 SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：4.38 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：误召回

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-1ca4616f69b2013496845e44 | 12.000000 | no | no | 磁盘使用率过高告警处理方案 > 常见原因分析 > 原因1: 日志文件过大 |
| 2 | doc-05acb1a777e3f2d26770 | chunk-465784fd5987c9e993a20490 | 10.000000 | no | no | 磁盘使用率过高告警处理方案 > 常见原因分析 > 原因3: 数据文件增长过快 |

#### no-match-kubernetes-image

- 分类：no-match
- 查询：Kubernetes Pod 出现 ImagePullBackOff，私有镜像拉取失败
- 预期证据：当前五篇源文档没有 Kubernetes 镜像拉取 SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：4.79 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：正确

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

### TF-IDF Retrieval

#### cpu-alert-original

- 分类：alert-original
- 查询：HighCPUUsage：CPU使用率连续5分钟超过80%
- 预期证据：HighCPUUsage 的名称和连续5分钟超过80%的触发条件。
- 判定规则：Top-K 必须命中 CPU 告警名称 Chunk。
- 耗时：44.62 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-094dcba6890817ca95611e6b | 0.510474 | yes | yes | CPU使用率过高告警处理方案 > 告警名称 |
| 2 | doc-05acb1a777e3f2d26770 | chunk-4405153dab2f5f08a0983d03 | 0.315144 | no | no | 磁盘使用率过高告警处理方案 > 告警名称 |
| 3 | doc-184fe84cc86bdb9910db | chunk-3ec307e6af9b7a7db852c7c4 | 0.300363 | no | no | 内存使用率过高告警处理方案 > 告警名称 |

#### cpu-colloquial-hot-process

- 分类：colloquial
- 查询：机器突然很卡，有个进程快把一个核吃满了，错误堆栈还一直刷
- 预期证据：单进程 CPU 接近100%和重复错误堆栈对应死循环或无限递归。
- 判定规则：Top-K 必须命中 CPU SOP 的死循环或无限递归 Chunk。
- 耗时：5.85 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-3e5314485beed7f55e5c5e4b | 0.226283 | yes | yes | CPU使用率过高告警处理方案 > 常见原因分析 > 原因1: 死循环或无限递归 |

#### cpu-cron-overlap

- 分类：similar-sop
- 查询：负载只在固定时间冲高，怀疑两个定时任务撞在一起执行
- 预期证据：定时任务重叠执行的周期性特征、错峰与互斥锁建议。
- 判定规则：Top-K 必须命中 CPU SOP 的定时任务重叠 Chunk，而非泛化到慢响应 SOP。
- 耗时：6.97 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-38dd1ad77f3a34a17bf994ad | 0.480710 | yes | yes | CPU使用率过高告警处理方案 > 常见原因分析 > 原因3: 定时任务重叠执行 |

#### cpu-step-system-logs

- 分类：troubleshooting-step
- 查询：CPU告警后查 system-metrics 时地域、时间范围和查询条件是什么
- 预期证据：CPU SOP 查询 system-metrics 的地域、最近30分钟和 cpu_usage 条件。
- 判定规则：Top-K 必须命中 CPU 排查步骤2的系统日志查询 Chunk。
- 耗时：7.54 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-692b536f3f8f15e683874839 | 0.380449 | yes | yes | CPU使用率过高告警处理方案 > 排查步骤 > 步骤2: 查询系统日志 |
| 2 | doc-184fe84cc86bdb9910db | chunk-19694e21dd2e9e1221822595 | 0.371010 | no | no | 内存使用率过高告警处理方案 > 排查步骤 > 步骤2: 查询系统监控日志 |
| 3 | doc-05acb1a777e3f2d26770 | chunk-fd48b59be22c38a259753bf5 | 0.355234 | no | no | 磁盘使用率过高告警处理方案 > 排查步骤 > 步骤2: 查询系统磁盘使用情况 |

#### disk-alert-original

- 分类：alert-original
- 查询：HighDiskUsage 严重告警，磁盘使用率持续5分钟超过90%
- 预期证据：HighDiskUsage 告警名、80%警告和90%严重阈值。
- 判定规则：Top-K 必须命中磁盘告警名称 Chunk。
- 耗时：6.78 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-4405153dab2f5f08a0983d03 | 0.529950 | yes | yes | 磁盘使用率过高告警处理方案 > 告警名称 |
| 2 | doc-11fb79358af9ffa4cc6e | chunk-094dcba6890817ca95611e6b | 0.351359 | no | no | CPU使用率过高告警处理方案 > 告警名称 |
| 3 | doc-184fe84cc86bdb9910db | chunk-3ec307e6af9b7a7db852c7c4 | 0.320177 | no | no | 内存使用率过高告警处理方案 > 告警名称 |

#### disk-colloquial-growing-log

- 分类：colloquial
- 查询：根盘快爆了，var log 里的应用日志还在不停变大
- 预期证据：/var/log 占用大且应用日志持续增长的日志文件过大场景。
- 判定规则：Top-K 必须命中磁盘 SOP 的日志文件过大 Chunk。
- 耗时：10.26 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-1ca4616f69b2013496845e44 | 0.372873 | yes | yes | 磁盘使用率过高告警处理方案 > 常见原因分析 > 原因1: 日志文件过大 |
| 2 | doc-05acb1a777e3f2d26770 | chunk-832ed316ecc1acdd0981c1e5 | 0.250758 | yes | no | 磁盘使用率过高告警处理方案 > 常用命令 > 清理命令 |
| 3 | doc-184fe84cc86bdb9910db | chunk-c194952690f4748757d10da1 | 0.214179 | no | no | 内存使用率过高告警处理方案 > 排查步骤 > 步骤3: 查询应用日志 |

#### disk-step-inode

- 分类：troubleshooting-step
- 查询：文件系统 inode 快耗尽，应该用什么命令检查
- 预期证据：使用 df -i 查看 inode 使用情况。
- 判定规则：Top-K 必须命中磁盘常用命令中的 inode 检查 Chunk。
- 耗时：5.85 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-38b259a2d306f8bfddff1119 | 0.374936 | yes | no | 磁盘使用率过高告警处理方案 > 相关告警 |

#### disk-docker-resources

- 分类：similar-sop
- 查询：Docker 未使用镜像、停止容器和容器日志把磁盘占满
- 预期证据：Docker 镜像、停止容器、卷和容器日志占用的排查内容。
- 判定规则：Top-K 必须命中磁盘 SOP 的 Docker 资源 Chunk。
- 耗时：5.46 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-0271f108b934bc30a72a72db | 0.522995 | yes | yes | 磁盘使用率过高告警处理方案 > 常见原因分析 > 原因6: Docker镜像和容器占用 |

#### disk-step-largest-path

- 分类：troubleshooting-step
- 查询：磁盘满了以后怎样判断是哪个目录、日志还是数据文件增长
- 预期证据：分析最大目录、日志大小、临时文件数量和数据增长趋势。
- 判定规则：Top-K 必须命中磁盘排查步骤4的占用分析 Chunk。
- 耗时：6.41 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-aa4f672093148fbe13e47eed | 0.464764 | yes | yes | 磁盘使用率过高告警处理方案 > 排查步骤 > 步骤4: 分析磁盘占用 |

#### memory-alert-original

- 分类：alert-original
- 查询：HighMemoryUsage：内存使用率持续5分钟超过85%
- 预期证据：HighMemoryUsage 名称和持续5分钟超过85%的触发条件。
- 判定规则：Top-K 必须命中内存告警名称 Chunk。
- 耗时：6.93 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-184fe84cc86bdb9910db | chunk-3ec307e6af9b7a7db852c7c4 | 0.615116 | yes | yes | 内存使用率过高告警处理方案 > 告警名称 |
| 2 | doc-11fb79358af9ffa4cc6e | chunk-094dcba6890817ca95611e6b | 0.390529 | no | no | CPU使用率过高告警处理方案 > 告警名称 |
| 3 | doc-05acb1a777e3f2d26770 | chunk-4405153dab2f5f08a0983d03 | 0.324730 | no | no | 磁盘使用率过高告警处理方案 > 告警名称 |

#### memory-colloquial-leak

- 分类：colloquial
- 查询：服务跑得越久越吃内存，Full GC 之后也降不下来
- 预期证据：内存持续缓慢上升且 Full GC 后无法释放的泄漏特征。
- 判定规则：Top-K 必须命中内存泄漏 Chunk。
- 耗时：14.37 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：0.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-184fe84cc86bdb9910db | chunk-e064a51fc775f4133a37df79 | 0.242813 | yes | no | 内存使用率过高告警处理方案 > 相关工具命令 > 查看GC日志 |
| 2 | doc-184fe84cc86bdb9910db | chunk-7b7fd20f2ad44a0c3f70d9e1 | 0.205815 | yes | yes | 内存使用率过高告警处理方案 > 常见原因分析 > 原因1: 内存泄漏 |

#### memory-step-oom-logs

- 分类：troubleshooting-step
- 查询：应用出现 OutOfMemoryError 和 GC overhead，要查哪类应用日志
- 预期证据：application-logs 中查询 OutOfMemoryError 或 GC overhead。
- 判定规则：Top-K 必须命中内存排查步骤3的应用日志查询 Chunk。
- 耗时：15.09 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-184fe84cc86bdb9910db | chunk-c194952690f4748757d10da1 | 0.343684 | yes | yes | 内存使用率过高告警处理方案 > 排查步骤 > 步骤3: 查询应用日志 |

#### memory-step-jmap-dump

- 分类：troubleshooting-step
- 查询：怎样用 jmap 生成 heap.hprof 堆快照
- 预期证据：jmap -dump:format=b,file=heap.hprof 命令。
- 判定规则：Top-K 必须命中生成堆转储文件 Chunk。
- 耗时：9.99 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-184fe84cc86bdb9910db | chunk-6bd767e4e4646f198324f493 | 0.312273 | yes | yes | 内存使用率过高告警处理方案 > 相关工具命令 > 生成堆转储文件 |

#### service-alert-original

- 分类：alert-original
- 查询：ServiceUnavailable：健康检查失败或错误率超过50%
- 预期证据：ServiceUnavailable 名称、健康检查失败和错误率超过50%的条件。
- 判定规则：Top-K 必须命中服务不可用告警名称 Chunk。
- 耗时：11.69 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-4725225aba6d608a1b83917b | 0.632596 | yes | yes | 服务不可用告警处理方案 > 告警名称 |
| 2 | doc-8a0cb13b4f7374ce31cc | chunk-964f366a99e29953dd7dbe9c | 0.288438 | yes | no | 服务不可用告警处理方案 > 相关告警 |

#### service-colloquial-all-down

- 分类：colloquial
- 查询：接口全挂了，健康检查一片红，用户完全进不去
- 预期证据：所有实例无法响应且健康检查全部失败的应用崩溃场景。
- 判定规则：Top-K 必须命中服务不可用 SOP 的应用崩溃 Chunk。
- 耗时：8.61 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-a0b870df6946b209af630350 | 0.228445 | yes | no | 服务不可用告警处理方案 > 验证步骤 |

#### service-step-dependencies

- 分类：troubleshooting-step
- 查询：服务不可用时怎样检查 database、redis 和 mq 下游依赖
- 预期证据：查询 application-logs 中 downstream_service、database、redis、mq。
- 判定规则：Top-K 必须命中检查依赖服务状态的排查步骤 Chunk。
- 耗时：10.15 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-899ad13f1d5f233d082b68bb | 0.405544 | yes | yes | 服务不可用告警处理方案 > 排查步骤 > 步骤4: 检查依赖服务状态 |
| 2 | doc-8a0cb13b4f7374ce31cc | chunk-8ab848f917d940342b53e027 | 0.284051 | yes | no | 服务不可用告警处理方案 > 常见原因分析 > 原因3: 依赖服务故障 |
| 3 | doc-8a0cb13b4f7374ce31cc | chunk-ad2d8df14f512ccc1ff7ed53 | 0.220358 | yes | no | 服务不可用告警处理方案 > 问题描述 |

#### service-release-rollback

- 分类：similar-sop
- 查询：新版本发布后所有实例都无法响应，需要回到上一个稳定版本
- 预期证据：新版本发布后全部故障时回滚稳定版本。
- 判定规则：Top-K 必须命中服务不可用 SOP 的应用崩溃与回滚 Chunk。
- 耗时：5.72 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-7396881d68063b860624abd2 | 0.384444 | yes | yes | 服务不可用告警处理方案 > 常见原因分析 > 原因1: 应用崩溃或无法启动 |

#### service-similar-oom-outage

- 分类：similar-sop
- 查询：服务已经不可用，同时机器内存不足并出现 OOM，先查资源耗尽场景
- 预期证据：服务不可用 SOP 中资源耗尽包含内存不足导致 OOM。
- 判定规则：以服务不可用为主问题，Top-K 必须命中服务不可用的资源耗尽 Chunk，而不只命中内存 SOP。
- 耗时：5.74 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-b3922ff1100f13e5dde4ad13 | 0.284349 | yes | yes | 服务不可用告警处理方案 > 常见原因分析 > 原因5: 资源耗尽 |

#### slow-alert-original

- 分类：alert-original
- 查询：SlowResponse：P99响应时间持续5分钟超过3秒
- 预期证据：SlowResponse 名称和 P99 持续5分钟超过3秒的触发条件。
- 判定规则：Top-K 必须命中慢响应告警名称 Chunk。
- 耗时：5.12 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-5d98b18e456ad5b295cf | chunk-4efc966828f5286791a9f177 | 0.568017 | yes | yes | 服务响应时间过长告警处理方案 > 告警名称 |
| 2 | doc-5d98b18e456ad5b295cf | chunk-ec4bdd3f8d725ae092ee2f86 | 0.235691 | yes | no | 服务响应时间过长告警处理方案 > 问题描述 |

#### slow-colloquial-p99

- 分类：colloquial
- 查询：接口越来越慢，尾延迟已经三秒多，超时请求也变多了
- 预期证据：P99 超过3秒的慢响应告警。
- 判定规则：Top-K 必须命中慢响应告警 Chunk。
- 耗时：4.72 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### slow-sql-n-plus-one

- 分类：similar-sop
- 查询：接口慢，数据库有慢查询，而且代码可能存在 N+1 查询
- 预期证据：数据库慢查询原因分析以及 N+1 性能检查项。
- 判定规则：Top-3 应覆盖慢查询原因 Chunk 和含 N+1 的检查清单 Chunk。
- 耗时：5.43 ms
- Document R@1/R@3：0.00% / 100.00%
- Evidence Chunk R@1/R@3：0.00% / 50.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-29faa671b6d2702fb506caa0 | 0.248006 | no | no | CPU使用率过高告警处理方案 > 常见原因分析 > 原因4: 数据库查询慢 |
| 2 | doc-5d98b18e456ad5b295cf | chunk-3df7a052230e28d3bc2eb142 | 0.247895 | yes | yes | 服务响应时间过长告警处理方案 > 常见原因分析 > 原因1: 数据库慢查询 |

#### slow-external-api-timeout

- 分类：similar-sop
- 查询：第三方 API 响应很慢，HTTP 客户端还没有连接和读取超时
- 预期证据：外部 API 调用超时以及连接、读取超时设置。
- 判定规则：Top-K 必须命中慢响应 SOP 的外部 API 调用超时 Chunk。
- 耗时：5.20 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-5d98b18e456ad5b295cf | chunk-498af4258a2044d87be7c8f2 | 0.310507 | yes | yes | 服务响应时间过长告警处理方案 > 常见原因分析 > 原因2: 外部API调用超时 |

#### slow-step-system-resources

- 分类：troubleshooting-step
- 查询：响应时间过长时怎样同时查询 cpu、memory 和 disk io 指标
- 预期证据：慢响应排查步骤中查询 system-metrics 的 CPU、内存和磁盘 IO。
- 判定规则：Top-K 必须命中慢响应排查步骤4的系统资源查询 Chunk。
- 耗时：5.24 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-5d98b18e456ad5b295cf | chunk-61e29088586e6beeaa2c14e2 | 0.354236 | yes | yes | 服务响应时间过长告警处理方案 > 排查步骤 > 步骤4: 查询系统资源使用情况 |
| 2 | doc-5d98b18e456ad5b295cf | chunk-bbf822b689231719338bda59 | 0.298613 | yes | no | 服务响应时间过长告警处理方案 > 相关监控指标 |
| 3 | doc-5d98b18e456ad5b295cf | chunk-4efc966828f5286791a9f177 | 0.270428 | yes | no | 服务响应时间过长告警处理方案 > 告警名称 |

#### no-match-gpu-xid

- 分类：no-match
- 查询：GPU 出现 Xid 79 并从 PCIe 总线掉线
- 预期证据：当前五篇源文档没有 GPU Xid SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：4.40 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：正确

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### no-match-certificate

- 分类：no-match
- 查询：TLS 证书即将过期如何续签
- 预期证据：当前五篇源文档没有证书续签 SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：4.60 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：正确

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### no-match-ntp

- 分类：no-match
- 查询：NTP 时钟不同步导致服务器时间漂移
- 预期证据：当前五篇源文档没有 NTP SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：5.06 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：正确

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### no-match-kafka-lag

- 分类：no-match
- 查询：Kafka consumer group lag 持续增长，offset 提交失败
- 预期证据：当前五篇源文档没有 Kafka 消费积压 SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：5.52 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：正确

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### no-match-kubernetes-image

- 分类：no-match
- 查询：Kubernetes Pod 出现 ImagePullBackOff，私有镜像拉取失败
- 预期证据：当前五篇源文档没有 Kubernetes 镜像拉取 SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：4.99 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：误召回

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-0271f108b934bc30a72a72db | 0.203895 | no | no | 磁盘使用率过高告警处理方案 > 常见原因分析 > 原因6: Docker镜像和容器占用 |

### Embedding Retrieval

#### cpu-alert-original

- 分类：alert-original
- 查询：HighCPUUsage：CPU使用率连续5分钟超过80%
- 预期证据：HighCPUUsage 的名称和连续5分钟超过80%的触发条件。
- 判定规则：Top-K 必须命中 CPU 告警名称 Chunk。
- 耗时：20.32 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-094dcba6890817ca95611e6b | 0.842927 | yes | yes | CPU使用率过高告警处理方案 > 告警名称 |
| 2 | doc-11fb79358af9ffa4cc6e | chunk-e024f4dd7fc7f37eca96ca50 | 0.751999 | yes | no | CPU使用率过高告警处理方案 > 相关告警 |
| 3 | doc-11fb79358af9ffa4cc6e | chunk-6803365c24d10a62ef6baf8b | 0.743801 | yes | no | CPU使用率过高告警处理方案 > 紧急处理措施 > 短期措施（30分钟内） |

#### cpu-colloquial-hot-process

- 分类：colloquial
- 查询：机器突然很卡，有个进程快把一个核吃满了，错误堆栈还一直刷
- 预期证据：单进程 CPU 接近100%和重复错误堆栈对应死循环或无限递归。
- 判定规则：Top-K 必须命中 CPU SOP 的死循环或无限递归 Chunk。
- 耗时：7.32 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-3e5314485beed7f55e5c5e4b | 0.607397 | yes | yes | CPU使用率过高告警处理方案 > 常见原因分析 > 原因1: 死循环或无限递归 |
| 2 | doc-11fb79358af9ffa4cc6e | chunk-33ddc80ee89100a1c0564b75 | 0.557133 | yes | no | CPU使用率过高告警处理方案 > 验证步骤 |
| 3 | doc-11fb79358af9ffa4cc6e | chunk-8f6f424f46b160b15b688ed2 | 0.553696 | yes | no | CPU使用率过高告警处理方案 > 问题描述 |

#### cpu-cron-overlap

- 分类：similar-sop
- 查询：负载只在固定时间冲高，怀疑两个定时任务撞在一起执行
- 预期证据：定时任务重叠执行的周期性特征、错峰与互斥锁建议。
- 判定规则：Top-K 必须命中 CPU SOP 的定时任务重叠 Chunk，而非泛化到慢响应 SOP。
- 耗时：6.78 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-38dd1ad77f3a34a17bf994ad | 0.525356 | yes | yes | CPU使用率过高告警处理方案 > 常见原因分析 > 原因3: 定时任务重叠执行 |
| 2 | doc-5d98b18e456ad5b295cf | chunk-bf1dc2da5445ec76e3961e87 | 0.501649 | no | no | 服务响应时间过长告警处理方案 > 紧急处理措施 > 立即操作（5分钟内） |
| 3 | doc-8a0cb13b4f7374ce31cc | chunk-8807b01f7bc905e3603893d6 | 0.483628 | no | no | 服务不可用告警处理方案 > 紧急处理流程 > 5分钟内 |

#### cpu-step-system-logs

- 分类：troubleshooting-step
- 查询：CPU告警后查 system-metrics 时地域、时间范围和查询条件是什么
- 预期证据：CPU SOP 查询 system-metrics 的地域、最近30分钟和 cpu_usage 条件。
- 判定规则：Top-K 必须命中 CPU 排查步骤2的系统日志查询 Chunk。
- 耗时：7.26 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-00a96200ca27f792ce9c3d80 | 0.833602 | yes | no | CPU使用率过高告警处理方案 > 排查步骤 > 步骤1: 获取当前时间 |
| 2 | doc-11fb79358af9ffa4cc6e | chunk-6803365c24d10a62ef6baf8b | 0.784965 | yes | no | CPU使用率过高告警处理方案 > 紧急处理措施 > 短期措施（30分钟内） |
| 3 | doc-11fb79358af9ffa4cc6e | chunk-33ddc80ee89100a1c0564b75 | 0.748312 | yes | no | CPU使用率过高告警处理方案 > 验证步骤 |

#### disk-alert-original

- 分类：alert-original
- 查询：HighDiskUsage 严重告警，磁盘使用率持续5分钟超过90%
- 预期证据：HighDiskUsage 告警名、80%警告和90%严重阈值。
- 判定规则：Top-K 必须命中磁盘告警名称 Chunk。
- 耗时：7.68 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-4405153dab2f5f08a0983d03 | 0.794765 | yes | yes | 磁盘使用率过高告警处理方案 > 告警名称 |
| 2 | doc-184fe84cc86bdb9910db | chunk-3ec307e6af9b7a7db852c7c4 | 0.720194 | no | no | 内存使用率过高告警处理方案 > 告警名称 |
| 3 | doc-05acb1a777e3f2d26770 | chunk-7f860f6c0335450f3d539b7d | 0.666645 | yes | no | 磁盘使用率过高告警处理方案 > 预防措施 |

#### disk-colloquial-growing-log

- 分类：colloquial
- 查询：根盘快爆了，var log 里的应用日志还在不停变大
- 预期证据：/var/log 占用大且应用日志持续增长的日志文件过大场景。
- 判定规则：Top-K 必须命中磁盘 SOP 的日志文件过大 Chunk。
- 耗时：6.89 ms
- Document R@1/R@3：0.00% / 100.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-184fe84cc86bdb9910db | chunk-22b6045242d96bca1595a2e8 | 0.497531 | no | no | 内存使用率过高告警处理方案 > 问题描述 |
| 2 | doc-05acb1a777e3f2d26770 | chunk-4de99d058815ff3c5429b8a2 | 0.471913 | yes | no | 磁盘使用率过高告警处理方案 > 排查步骤 > 步骤3: 查询应用日志 |
| 3 | doc-184fe84cc86bdb9910db | chunk-c194952690f4748757d10da1 | 0.462795 | no | no | 内存使用率过高告警处理方案 > 排查步骤 > 步骤3: 查询应用日志 |

#### disk-step-inode

- 分类：troubleshooting-step
- 查询：文件系统 inode 快耗尽，应该用什么命令检查
- 预期证据：使用 df -i 查看 inode 使用情况。
- 判定规则：Top-K 必须命中磁盘常用命令中的 inode 检查 Chunk。
- 耗时：6.70 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-38b259a2d306f8bfddff1119 | 0.712615 | yes | no | 磁盘使用率过高告警处理方案 > 相关告警 |
| 2 | doc-05acb1a777e3f2d26770 | chunk-cd4660d3c42222d7fc2fafa9 | 0.596557 | yes | no | 磁盘使用率过高告警处理方案 > 紧急处理措施 > 立即操作（5分钟内） |
| 3 | doc-05acb1a777e3f2d26770 | chunk-832ed316ecc1acdd0981c1e5 | 0.591600 | yes | no | 磁盘使用率过高告警处理方案 > 常用命令 > 清理命令 |

#### disk-docker-resources

- 分类：similar-sop
- 查询：Docker 未使用镜像、停止容器和容器日志把磁盘占满
- 预期证据：Docker 镜像、停止容器、卷和容器日志占用的排查内容。
- 判定规则：Top-K 必须命中磁盘 SOP 的 Docker 资源 Chunk。
- 耗时：6.54 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### disk-step-largest-path

- 分类：troubleshooting-step
- 查询：磁盘满了以后怎样判断是哪个目录、日志还是数据文件增长
- 预期证据：分析最大目录、日志大小、临时文件数量和数据增长趋势。
- 判定规则：Top-K 必须命中磁盘排查步骤4的占用分析 Chunk。
- 耗时：5.59 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-05acb1a777e3f2d26770 | chunk-aa4f672093148fbe13e47eed | 0.753517 | yes | yes | 磁盘使用率过高告警处理方案 > 排查步骤 > 步骤4: 分析磁盘占用 |
| 2 | doc-05acb1a777e3f2d26770 | chunk-8d9cf138e2e1fbb91fc0fa72 | 0.683533 | yes | no | 磁盘使用率过高告警处理方案 > 常用命令 > 查看磁盘使用情况 |
| 3 | doc-05acb1a777e3f2d26770 | chunk-05f87a19517858067ed0dee7 | 0.667156 | yes | no | 磁盘使用率过高告警处理方案 > 参考文档 |

#### memory-alert-original

- 分类：alert-original
- 查询：HighMemoryUsage：内存使用率持续5分钟超过85%
- 预期证据：HighMemoryUsage 名称和持续5分钟超过85%的触发条件。
- 判定规则：Top-K 必须命中内存告警名称 Chunk。
- 耗时：8.75 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-184fe84cc86bdb9910db | chunk-3ec307e6af9b7a7db852c7c4 | 0.795132 | yes | yes | 内存使用率过高告警处理方案 > 告警名称 |
| 2 | doc-184fe84cc86bdb9910db | chunk-d161d2b5ad551f87fea90221 | 0.701720 | yes | no | 内存使用率过高告警处理方案 > 验证步骤 |
| 3 | doc-5d98b18e456ad5b295cf | chunk-d6216882a15e6eaff6c2f709 | 0.666167 | no | no | 服务响应时间过长告警处理方案 > 相关告警 |

#### memory-colloquial-leak

- 分类：colloquial
- 查询：服务跑得越久越吃内存，Full GC 之后也降不下来
- 预期证据：内存持续缓慢上升且 Full GC 后无法释放的泄漏特征。
- 判定规则：Top-K 必须命中内存泄漏 Chunk。
- 耗时：5.67 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-184fe84cc86bdb9910db | chunk-22b6045242d96bca1595a2e8 | 0.613831 | yes | no | 内存使用率过高告警处理方案 > 问题描述 |
| 2 | doc-184fe84cc86bdb9910db | chunk-7824310161dffd13362f1d43 | 0.571256 | yes | no | 内存使用率过高告警处理方案 > 常见原因分析 > 原因2: 流量突增导致对象激增 |
| 3 | doc-5d98b18e456ad5b295cf | chunk-ec4bdd3f8d725ae092ee2f86 | 0.549170 | no | no | 服务响应时间过长告警处理方案 > 问题描述 |

#### memory-step-oom-logs

- 分类：troubleshooting-step
- 查询：应用出现 OutOfMemoryError 和 GC overhead，要查哪类应用日志
- 预期证据：application-logs 中查询 OutOfMemoryError 或 GC overhead。
- 判定规则：Top-K 必须命中内存排查步骤3的应用日志查询 Chunk。
- 耗时：6.87 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-184fe84cc86bdb9910db | chunk-c194952690f4748757d10da1 | 0.528909 | yes | yes | 内存使用率过高告警处理方案 > 排查步骤 > 步骤3: 查询应用日志 |
| 2 | doc-184fe84cc86bdb9910db | chunk-e064a51fc775f4133a37df79 | 0.495967 | yes | no | 内存使用率过高告警处理方案 > 相关工具命令 > 查看GC日志 |
| 3 | doc-184fe84cc86bdb9910db | chunk-7b7fd20f2ad44a0c3f70d9e1 | 0.489252 | yes | no | 内存使用率过高告警处理方案 > 常见原因分析 > 原因1: 内存泄漏 |

#### memory-step-jmap-dump

- 分类：troubleshooting-step
- 查询：怎样用 jmap 生成 heap.hprof 堆快照
- 预期证据：jmap -dump:format=b,file=heap.hprof 命令。
- 判定规则：Top-K 必须命中生成堆转储文件 Chunk。
- 耗时：6.82 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-184fe84cc86bdb9910db | chunk-6bd767e4e4646f198324f493 | 0.461548 | yes | yes | 内存使用率过高告警处理方案 > 相关工具命令 > 生成堆转储文件 |
| 2 | doc-184fe84cc86bdb9910db | chunk-8aeebe6e0e3805f104207a84 | 0.446620 | yes | no | 内存使用率过高告警处理方案 > 相关工具命令 > 查看JVM内存使用 |

#### service-alert-original

- 分类：alert-original
- 查询：ServiceUnavailable：健康检查失败或错误率超过50%
- 预期证据：ServiceUnavailable 名称、健康检查失败和错误率超过50%的条件。
- 判定规则：Top-K 必须命中服务不可用告警名称 Chunk。
- 耗时：5.62 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-4725225aba6d608a1b83917b | 0.792117 | yes | yes | 服务不可用告警处理方案 > 告警名称 |
| 2 | doc-8a0cb13b4f7374ce31cc | chunk-a0b870df6946b209af630350 | 0.683359 | yes | no | 服务不可用告警处理方案 > 验证步骤 |
| 3 | doc-8a0cb13b4f7374ce31cc | chunk-ad2d8df14f512ccc1ff7ed53 | 0.599952 | yes | no | 服务不可用告警处理方案 > 问题描述 |

#### service-colloquial-all-down

- 分类：colloquial
- 查询：接口全挂了，健康检查一片红，用户完全进不去
- 预期证据：所有实例无法响应且健康检查全部失败的应用崩溃场景。
- 判定规则：Top-K 必须命中服务不可用 SOP 的应用崩溃 Chunk。
- 耗时：7.89 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### service-step-dependencies

- 分类：troubleshooting-step
- 查询：服务不可用时怎样检查 database、redis 和 mq 下游依赖
- 预期证据：查询 application-logs 中 downstream_service、database、redis、mq。
- 判定规则：Top-K 必须命中检查依赖服务状态的排查步骤 Chunk。
- 耗时：6.06 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：0.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-edff910633f9639685ca4f00 | 0.694449 | yes | no | 服务不可用告警处理方案 > 常见原因分析 > 原因2: 数据库连接失败 |
| 2 | doc-8a0cb13b4f7374ce31cc | chunk-899ad13f1d5f233d082b68bb | 0.632436 | yes | yes | 服务不可用告警处理方案 > 排查步骤 > 步骤4: 检查依赖服务状态 |
| 3 | doc-8a0cb13b4f7374ce31cc | chunk-8ab848f917d940342b53e027 | 0.631422 | yes | no | 服务不可用告警处理方案 > 常见原因分析 > 原因3: 依赖服务故障 |

#### service-release-rollback

- 分类：similar-sop
- 查询：新版本发布后所有实例都无法响应，需要回到上一个稳定版本
- 预期证据：新版本发布后全部故障时回滚稳定版本。
- 判定规则：Top-K 必须命中服务不可用 SOP 的应用崩溃与回滚 Chunk。
- 耗时：5.58 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-7396881d68063b860624abd2 | 0.512597 | yes | yes | 服务不可用告警处理方案 > 常见原因分析 > 原因1: 应用崩溃或无法启动 |
| 2 | doc-8a0cb13b4f7374ce31cc | chunk-5a06a45847d23fd876006935 | 0.488866 | yes | no | 服务不可用告警处理方案 > 常见原因分析 > 原因4: 配置错误 |
| 3 | doc-8a0cb13b4f7374ce31cc | chunk-21d29ba5bcd5554e91e9e760 | 0.454897 | yes | no | 服务不可用告警处理方案 > 故障复盘 |

#### service-similar-oom-outage

- 分类：similar-sop
- 查询：服务已经不可用，同时机器内存不足并出现 OOM，先查资源耗尽场景
- 预期证据：服务不可用 SOP 中资源耗尽包含内存不足导致 OOM。
- 判定规则：以服务不可用为主问题，Top-K 必须命中服务不可用的资源耗尽 Chunk，而不只命中内存 SOP。
- 耗时：5.98 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-8a0cb13b4f7374ce31cc | chunk-ad2d8df14f512ccc1ff7ed53 | 0.647646 | yes | no | 服务不可用告警处理方案 > 问题描述 |
| 2 | doc-184fe84cc86bdb9910db | chunk-22b6045242d96bca1595a2e8 | 0.557775 | no | no | 内存使用率过高告警处理方案 > 问题描述 |
| 3 | doc-8a0cb13b4f7374ce31cc | chunk-4725225aba6d608a1b83917b | 0.518555 | yes | no | 服务不可用告警处理方案 > 告警名称 |

#### slow-alert-original

- 分类：alert-original
- 查询：SlowResponse：P99响应时间持续5分钟超过3秒
- 预期证据：SlowResponse 名称和 P99 持续5分钟超过3秒的触发条件。
- 判定规则：Top-K 必须命中慢响应告警名称 Chunk。
- 耗时：5.91 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-5d98b18e456ad5b295cf | chunk-4efc966828f5286791a9f177 | 0.836206 | yes | yes | 服务响应时间过长告警处理方案 > 告警名称 |
| 2 | doc-5d98b18e456ad5b295cf | chunk-46c7d19449bbdd23c2954301 | 0.666996 | yes | no | 服务响应时间过长告警处理方案 > 验证步骤 |
| 3 | doc-5d98b18e456ad5b295cf | chunk-bbf822b689231719338bda59 | 0.628029 | yes | no | 服务响应时间过长告警处理方案 > 相关监控指标 |

#### slow-colloquial-p99

- 分类：colloquial
- 查询：接口越来越慢，尾延迟已经三秒多，超时请求也变多了
- 预期证据：P99 超过3秒的慢响应告警。
- 判定规则：Top-K 必须命中慢响应告警 Chunk。
- 耗时：7.35 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-5d98b18e456ad5b295cf | chunk-4efc966828f5286791a9f177 | 0.574934 | yes | yes | 服务响应时间过长告警处理方案 > 告警名称 |
| 2 | doc-5d98b18e456ad5b295cf | chunk-ec4bdd3f8d725ae092ee2f86 | 0.551682 | yes | no | 服务响应时间过长告警处理方案 > 问题描述 |
| 3 | doc-5d98b18e456ad5b295cf | chunk-498af4258a2044d87be7c8f2 | 0.532231 | yes | no | 服务响应时间过长告警处理方案 > 常见原因分析 > 原因2: 外部API调用超时 |

#### slow-sql-n-plus-one

- 分类：similar-sop
- 查询：接口慢，数据库有慢查询，而且代码可能存在 N+1 查询
- 预期证据：数据库慢查询原因分析以及 N+1 性能检查项。
- 判定规则：Top-3 应覆盖慢查询原因 Chunk 和含 N+1 的检查清单 Chunk。
- 耗时：6.56 ms
- Document R@1/R@3：0.00% / 100.00%
- Evidence Chunk R@1/R@3：0.00% / 50.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-29faa671b6d2702fb506caa0 | 0.621977 | no | no | CPU使用率过高告警处理方案 > 常见原因分析 > 原因4: 数据库查询慢 |
| 2 | doc-5d98b18e456ad5b295cf | chunk-3df7a052230e28d3bc2eb142 | 0.579252 | yes | yes | 服务响应时间过长告警处理方案 > 常见原因分析 > 原因1: 数据库慢查询 |
| 3 | doc-5d98b18e456ad5b295cf | chunk-750e6fed440a06b7e77ba296 | 0.570739 | yes | no | 服务响应时间过长告警处理方案 > 排查步骤 > 步骤3: 查询数据库慢查询日志 |

#### slow-external-api-timeout

- 分类：similar-sop
- 查询：第三方 API 响应很慢，HTTP 客户端还没有连接和读取超时
- 预期证据：外部 API 调用超时以及连接、读取超时设置。
- 判定规则：Top-K 必须命中慢响应 SOP 的外部 API 调用超时 Chunk。
- 耗时：6.23 ms
- Document R@1/R@3：100.00% / 100.00%
- Evidence Chunk R@1/R@3：100.00% / 100.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-5d98b18e456ad5b295cf | chunk-498af4258a2044d87be7c8f2 | 0.513260 | yes | yes | 服务响应时间过长告警处理方案 > 常见原因分析 > 原因2: 外部API调用超时 |
| 2 | doc-5d98b18e456ad5b295cf | chunk-d6216882a15e6eaff6c2f709 | 0.501920 | yes | no | 服务响应时间过长告警处理方案 > 相关告警 |
| 3 | doc-8a0cb13b4f7374ce31cc | chunk-edff910633f9639685ca4f00 | 0.465179 | no | no | 服务不可用告警处理方案 > 常见原因分析 > 原因2: 数据库连接失败 |

#### slow-step-system-resources

- 分类：troubleshooting-step
- 查询：响应时间过长时怎样同时查询 cpu、memory 和 disk io 指标
- 预期证据：慢响应排查步骤中查询 system-metrics 的 CPU、内存和磁盘 IO。
- 判定规则：Top-K 必须命中慢响应排查步骤4的系统资源查询 Chunk。
- 耗时：6.18 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：N/A

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-11fb79358af9ffa4cc6e | chunk-6803365c24d10a62ef6baf8b | 0.697541 | no | no | CPU使用率过高告警处理方案 > 紧急处理措施 > 短期措施（30分钟内） |
| 2 | doc-11fb79358af9ffa4cc6e | chunk-33ddc80ee89100a1c0564b75 | 0.693586 | no | no | CPU使用率过高告警处理方案 > 验证步骤 |
| 3 | doc-11fb79358af9ffa4cc6e | chunk-00a96200ca27f792ce9c3d80 | 0.688067 | no | no | CPU使用率过高告警处理方案 > 排查步骤 > 步骤1: 获取当前时间 |

#### no-match-gpu-xid

- 分类：no-match
- 查询：GPU 出现 Xid 79 并从 PCIe 总线掉线
- 预期证据：当前五篇源文档没有 GPU Xid SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：7.04 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：正确

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### no-match-certificate

- 分类：no-match
- 查询：TLS 证书即将过期如何续签
- 预期证据：当前五篇源文档没有证书续签 SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：5.50 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：正确

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### no-match-ntp

- 分类：no-match
- 查询：NTP 时钟不同步导致服务器时间漂移
- 预期证据：当前五篇源文档没有 NTP SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：6.79 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：误召回

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | doc-5d98b18e456ad5b295cf | chunk-bbf822b689231719338bda59 | 0.461707 | no | no | 服务响应时间过长告警处理方案 > 相关监控指标 |
| 2 | doc-5d98b18e456ad5b295cf | chunk-d6216882a15e6eaff6c2f709 | 0.456938 | no | no | 服务响应时间过长告警处理方案 > 相关告警 |
| 3 | doc-5d98b18e456ad5b295cf | chunk-ec4bdd3f8d725ae092ee2f86 | 0.442182 | no | no | 服务响应时间过长告警处理方案 > 问题描述 |

#### no-match-kafka-lag

- 分类：no-match
- 查询：Kafka consumer group lag 持续增长，offset 提交失败
- 预期证据：当前五篇源文档没有 Kafka 消费积压 SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：5.62 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：正确

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |

#### no-match-kubernetes-image

- 分类：no-match
- 查询：Kubernetes Pod 出现 ImagePullBackOff，私有镜像拉取失败
- 预期证据：当前五篇源文档没有 Kubernetes 镜像拉取 SOP。
- 判定规则：Top-3 返回空结果才算正确拒识。
- 耗时：7.54 ms
- Document R@1/R@3：0.00% / 0.00%
- Evidence Chunk R@1/R@3：0.00% / 0.00%
- No-match：正确

| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |
| ---: | --- | --- | ---: | --- | --- | --- |
| - | NO_MATCH | - | - | - | - | - |
