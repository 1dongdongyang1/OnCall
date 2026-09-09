import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SopSearchResult, SopSource } from "../data-sources/sop-source.js";
import { buildChunkStore, type ChunkStore } from "./chunk-store.js";
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_MODEL_REVISION,
  HuggingFaceEmbedder,
} from "./embedder.js";
import {
  buildLocalEmbeddingIndex,
  DEFAULT_EMBEDDING_MINIMUM_SCORE,
  LocalEmbeddingSopSource,
  type LocalEmbeddingIndex,
} from "./local-embedding-index.js";
import {
  buildLocalKeywordIndex,
  DEFAULT_KEYWORD_MINIMUM_SCORE,
  LocalKeywordSopSource,
} from "./local-keyword-index.js";
import {
  buildLocalTfidfIndex,
  DEFAULT_TFIDF_MINIMUM_SCORE,
  LocalTfidfSopSource,
} from "./local-tfidf-index.js";

type EvaluationCategory =
  | "alert-original"
  | "colloquial"
  | "troubleshooting-step"
  | "similar-sop"
  | "no-match";

type EvaluationCase = {
  id: string;
  category: EvaluationCategory;
  query: string;
  expectedDocumentIds: string[];
  expectedChunkIds: string[];
  expectedEvidence: string;
  decisionRule: string;
};

type CaseEvaluation = {
  item: EvaluationCase;
  results: SopSearchResult[];
  elapsedMs: number;
  documentRecallAt1: number;
  documentRecallAt3: number;
  chunkRecallAt1: number;
  chunkRecallAt3: number;
  noMatchCorrect?: boolean;
};

type Metrics = {
  documentRecallAt1: number;
  documentRecallAt3: number;
  chunkRecallAt1: number;
  chunkRecallAt3: number;
  noMatchAccuracy: number;
  averageLatencyMs: number;
};

type RetrieverEvaluation = {
  name: string;
  minimumScore: number;
  cases: CaseEvaluation[];
  metrics: Metrics;
};

const TOP_K = 3;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function recall(expected: string[], actual: string[]): number {
  if (!expected.length) {
    return 0;
  }
  const actualSet = new Set(actual);
  return expected.filter((id) => actualSet.has(id)).length / expected.length;
}

function average(values: number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function validateCases(cases: EvaluationCase[], store: ChunkStore): void {
  const knownDocuments = new Set(store.documents.map((document) => document.documentId));
  const chunksById = new Map(store.chunks.map((chunk) => [chunk.chunkId, chunk]));
  const caseIds = new Set<string>();

  for (const item of cases) {
    if (caseIds.has(item.id)) {
      throw new Error(`评测集包含重复 id：${item.id}`);
    }
    caseIds.add(item.id);
    if (!item.query.trim() || !item.expectedEvidence.trim() || !item.decisionRule.trim()) {
      throw new Error(`评测样本缺少查询、证据或判定规则：${item.id}`);
    }
    if (item.category === "no-match") {
      if (item.expectedDocumentIds.length || item.expectedChunkIds.length) {
        throw new Error(`no-match 样本不能声明预期文档或 Chunk：${item.id}`);
      }
      continue;
    }
    if (!item.expectedDocumentIds.length || !item.expectedChunkIds.length) {
      throw new Error(`正样本必须声明 documentId 和相关 chunkId：${item.id}`);
    }
    for (const documentId of item.expectedDocumentIds) {
      if (!knownDocuments.has(documentId)) {
        throw new Error(`评测样本引用未知 documentId：${item.id}/${documentId}`);
      }
    }
    for (const chunkId of item.expectedChunkIds) {
      const chunk = chunksById.get(chunkId);
      if (!chunk) {
        throw new Error(`评测样本引用未知 chunkId：${item.id}/${chunkId}`);
      }
      if (!item.expectedDocumentIds.includes(chunk.documentId)) {
        throw new Error(`评测 Chunk 不属于预期文档：${item.id}/${chunkId}`);
      }
    }
  }
}

async function evaluate(
  name: string,
  minimumScore: number,
  source: SopSource,
  cases: EvaluationCase[],
): Promise<RetrieverEvaluation> {
  const evaluated: CaseEvaluation[] = [];
  for (const item of cases) {
    const startedAt = performance.now();
    const results = await source.search(item.query, TOP_K);
    const elapsedMs = performance.now() - startedAt;
    const documentIds = results.map((result) => result.documentId);
    const chunkIds = results.map((result) => result.chunkId);
    const positive = item.expectedDocumentIds.length > 0;
    evaluated.push({
      item,
      results,
      elapsedMs,
      documentRecallAt1: positive
        ? recall(item.expectedDocumentIds, documentIds.slice(0, 1))
        : 0,
      documentRecallAt3: positive
        ? recall(item.expectedDocumentIds, documentIds.slice(0, TOP_K))
        : 0,
      chunkRecallAt1: positive
        ? recall(item.expectedChunkIds, chunkIds.slice(0, 1))
        : 0,
      chunkRecallAt3: positive
        ? recall(item.expectedChunkIds, chunkIds.slice(0, TOP_K))
        : 0,
      ...(positive ? {} : { noMatchCorrect: results.length === 0 }),
    });
  }

  const positiveCases = evaluated.filter(
    ({ item }) => item.expectedDocumentIds.length > 0,
  );
  const noMatchCases = evaluated.filter(
    ({ item }) => item.expectedDocumentIds.length === 0,
  );
  return {
    name,
    minimumScore,
    cases: evaluated,
    metrics: {
      documentRecallAt1: average(
        positiveCases.map((item) => item.documentRecallAt1),
      ),
      documentRecallAt3: average(
        positiveCases.map((item) => item.documentRecallAt3),
      ),
      chunkRecallAt1: average(
        positiveCases.map((item) => item.chunkRecallAt1),
      ),
      chunkRecallAt3: average(
        positiveCases.map((item) => item.chunkRecallAt3),
      ),
      noMatchAccuracy: average(
        noMatchCases.map((item) => (item.noMatchCorrect ? 1 : 0)),
      ),
      averageLatencyMs: average(evaluated.map((item) => item.elapsedMs)),
    },
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatResult(
  result: SopSearchResult,
  item: EvaluationCase,
): string {
  const documentHit = item.expectedDocumentIds.includes(result.documentId) ? "D✓" : "D✗";
  const chunkHit = item.expectedChunkIds.includes(result.chunkId) ? "C✓" : "C✗";
  return `${result.documentId}/${result.chunkId} score=${result.score.toFixed(4)} ${documentHit}/${chunkHit}`;
}

function printEvaluation(evaluation: RetrieverEvaluation): void {
  const metrics = evaluation.metrics;
  process.stdout.write(
    `${evaluation.name}\n` +
      `Document Recall@1: ${formatPercent(metrics.documentRecallAt1)}\n` +
      `Document Recall@3: ${formatPercent(metrics.documentRecallAt3)}\n` +
      `Evidence Chunk Recall@1: ${formatPercent(metrics.chunkRecallAt1)}\n` +
      `Evidence Chunk Recall@3: ${formatPercent(metrics.chunkRecallAt3)}\n` +
      `No-match accuracy: ${formatPercent(metrics.noMatchAccuracy)}\n` +
      `Average latency: ${metrics.averageLatencyMs.toFixed(2)} ms/query\n`,
  );
  for (const result of evaluation.cases) {
    const topK = result.results
      .map((item) => formatResult(item, result.item))
      .join(" | ");
    const hit = result.item.expectedDocumentIds.length
      ? result.documentRecallAt3 === 1 && result.chunkRecallAt3 === 1
      : result.noMatchCorrect;
    process.stdout.write(
      `  [${hit ? "HIT" : "MISS"}] ${result.item.id} ` +
        `(${result.item.category}, ${result.elapsedMs.toFixed(2)} ms): ` +
        `${topK || "NO_MATCH"}\n`,
    );
  }
  process.stdout.write("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function failureIds(
  evaluation: RetrieverEvaluation,
  select: (item: CaseEvaluation) => boolean,
): string {
  const ids = evaluation.cases.filter(select).map(({ item }) => item.id);
  return ids.length ? ids.join(", ") : "无";
}

function evidenceOutcome(
  evaluation: RetrieverEvaluation,
  caseId: string,
): CaseEvaluation {
  const result = evaluation.cases.find(({ item }) => item.id === caseId);
  if (!result) {
    throw new Error(`检索结果缺少评测样本：${evaluation.name}/${caseId}`);
  }
  return result;
}

function createMarkdownReport(
  generatedAt: string,
  store: ChunkStore,
  evaluationCaseHash: string,
  embeddingIndex: LocalEmbeddingIndex,
  evaluations: RetrieverEvaluation[],
): string {
  const lines = [
    "# 统一 Chunk 检索评测报告",
    "",
    `- 生成时间：${generatedAt}`,
    `- Node.js：${process.version}`,
    `- 语料：${store.documents.length} documents / ${store.chunks.length} chunks`,
    `- ChunkStore SHA-256：\`${store.corpusHash}\``,
    `- 评测集 SHA-256：\`${evaluationCaseHash}\``,
    `- Embedding：\`${embeddingIndex.modelId}@${embeddingIndex.modelRevision}\`，${embeddingIndex.dimensions} dimensions`,
    `- Top-K：${TOP_K}`,
    "- 复现命令：`npm ci && npm run eval:retrieval`",
    "",
    "## 汇总指标",
    "",
    "| 检索器 | 阈值 | Document R@1 | Document R@3 | Evidence Chunk R@1 | Evidence Chunk R@3 | No-match accuracy | 平均耗时 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const evaluation of evaluations) {
    const metrics = evaluation.metrics;
    lines.push(
      `| ${evaluation.name} | ${evaluation.minimumScore} | ${formatPercent(metrics.documentRecallAt1)} | ${formatPercent(metrics.documentRecallAt3)} | ${formatPercent(metrics.chunkRecallAt1)} | ${formatPercent(metrics.chunkRecallAt3)} | ${formatPercent(metrics.noMatchAccuracy)} | ${metrics.averageLatencyMs.toFixed(2)} ms/query |`,
    );
  }

  lines.push("", "## 失败案例汇总", "");
  for (const evaluation of evaluations) {
    lines.push(
      `### ${evaluation.name}`,
      "",
      `- Document Recall@1 未满：${failureIds(evaluation, (item) => item.item.expectedDocumentIds.length > 0 && item.documentRecallAt1 < 1)}`,
      `- Document Recall@3 未满：${failureIds(evaluation, (item) => item.item.expectedDocumentIds.length > 0 && item.documentRecallAt3 < 1)}`,
      `- Evidence Chunk Recall@1 未满：${failureIds(evaluation, (item) => item.item.expectedChunkIds.length > 0 && item.chunkRecallAt1 < 1)}`,
      `- Evidence Chunk Recall@3 未满：${failureIds(evaluation, (item) => item.item.expectedChunkIds.length > 0 && item.chunkRecallAt3 < 1)}`,
      `- no-match 误召回：${failureIds(evaluation, (item) => item.noMatchCorrect === false)}`,
      "",
    );
  }

  const positiveCaseIds = evaluations[0].cases
    .filter(({ item }) => item.expectedDocumentIds.length > 0)
    .map(({ item }) => item.id);
  const commonEvidenceFailures = positiveCaseIds.filter((caseId) =>
    evaluations.every(
      (evaluation) => evidenceOutcome(evaluation, caseId).chunkRecallAt3 < 1,
    ),
  );
  const complementaryEvidenceCases = positiveCaseIds.filter((caseId) => {
    const outcomes = evaluations.map(
      (evaluation) => evidenceOutcome(evaluation, caseId).chunkRecallAt3 === 1,
    );
    return outcomes.some(Boolean) && outcomes.some((hit) => !hit);
  });
  const complementaryDetails = complementaryEvidenceCases.map((caseId) => {
    const hits = evaluations
      .filter(
        (evaluation) => evidenceOutcome(evaluation, caseId).chunkRecallAt3 === 1,
      )
      .map(({ name }) => name.replace(" Retrieval", ""));
    const misses = evaluations
      .filter(
        (evaluation) => evidenceOutcome(evaluation, caseId).chunkRecallAt3 < 1,
      )
      .map(({ name }) => name.replace(" Retrieval", ""));
    return `${caseId}（命中：${hits.join("/")}；未满：${misses.join("/")}）`;
  });

  lines.push(
    "## 失败分析与下一步判定",
    "",
    `- 三套检索共同未完整召回的证据样本：${commonEvidenceFailures.join(", ") || "无"}。共同失败不能靠简单合并候选解决，应优先检查查询与同文档内证据定位、多证据覆盖能力。`,
    `- 存在互补命中的证据样本：${complementaryDetails.join("；") || "无"}。这说明词法与语义候选有互补性，但不代表任意融合都会改善拒识。`,
    `- 三套检索的 no-match 误召回分别为：${evaluations.map((evaluation) => `${evaluation.name.replace(" Retrieval", "")}=[${failureIds(evaluation, (item) => item.noMatchCorrect === false)}]`).join("；")}。误召回样本并不相同，后续实验必须保留独立拒识阈值验证。`,
    "- `disk-step-inode` 的三套结果都命中了磁盘文档或相关 inode Chunk，却没有定位到包含 `df -i` 的命令 Chunk；这是证据定位失败，不是文档召回失败。",
    "- `slow-sql-n-plus-one` 的三套 Top-3 都只覆盖了两个预期 Chunk 中的慢查询原因，没有同时覆盖 N+1 检查清单；这是多证据覆盖失败。",
    "- 基于互补样本，可以进入下一轮简单混合检索实验：只比较 Keyword/TF-IDF 与 Embedding 的候选并集或 RRF，并继续以同一评测集验证 Chunk Recall 与 no-match。本次不实现融合或重排。",
    "- 耗时是本机单次运行的现场值，受首次模型推理、缓存与机器负载影响；语料哈希、评测集哈希和固定模型 revision 用于复现实验输入，不保证不同机器耗时相同。",
    "",
  );

  lines.push("## 逐条 Top-K", "");
  for (const evaluation of evaluations) {
    lines.push(`### ${evaluation.name}`, "");
    for (const result of evaluation.cases) {
      lines.push(
        `#### ${result.item.id}`,
        "",
        `- 分类：${result.item.category}`,
        `- 查询：${result.item.query}`,
        `- 预期证据：${result.item.expectedEvidence}`,
        `- 判定规则：${result.item.decisionRule}`,
        `- 耗时：${result.elapsedMs.toFixed(2)} ms`,
        `- Document R@1/R@3：${formatPercent(result.documentRecallAt1)} / ${formatPercent(result.documentRecallAt3)}`,
        `- Evidence Chunk R@1/R@3：${formatPercent(result.chunkRecallAt1)} / ${formatPercent(result.chunkRecallAt3)}`,
        `- No-match：${result.noMatchCorrect === undefined ? "N/A" : result.noMatchCorrect ? "正确" : "误召回"}`,
        "",
        "| Rank | Document | Chunk | Score | Doc hit | Chunk hit | Heading |",
        "| ---: | --- | --- | ---: | --- | --- | --- |",
      );
      if (!result.results.length) {
        lines.push("| - | NO_MATCH | - | - | - | - | - |");
      } else {
        result.results.forEach((item, index) => {
          lines.push(
            `| ${index + 1} | ${item.documentId} | ${item.chunkId} | ${item.score.toFixed(6)} | ${result.item.expectedDocumentIds.includes(item.documentId) ? "yes" : "no"} | ${result.item.expectedChunkIds.includes(item.chunkId) ? "yes" : "no"} | ${escapeCell(item.headingPath.join(" > "))} |`,
          );
        });
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

const sopDirectory = resolve("sops");
const chunkStorePath = resolve(".rag-index", "sop-chunks.json");
const keywordIndexPath = resolve(".rag-index", "sop-keyword-index.json");
const tfidfIndexPath = resolve(".rag-index", "sop-tfidf-index.json");
const embeddingIndexPath = resolve(".rag-index", "sop-embedding-index.json");
const reportPath = resolve("reports", "retrieval-evaluation.md");
const evaluationCasePath = resolve("src", "rag", "retrieval-eval-cases.json");
const evaluationCaseJson = await readFile(evaluationCasePath, "utf8");
const cases = JSON.parse(evaluationCaseJson) as EvaluationCase[];

const store = await buildChunkStore(sopDirectory, chunkStorePath);
validateCases(cases, store);
await buildLocalKeywordIndex(chunkStorePath, keywordIndexPath);
await buildLocalTfidfIndex(chunkStorePath, tfidfIndexPath);
const embedder = new HuggingFaceEmbedder();
const embeddingIndex = await buildLocalEmbeddingIndex(
  chunkStorePath,
  embeddingIndexPath,
  embedder,
);

const evaluations = [
  await evaluate(
    "Keyword Retrieval",
    DEFAULT_KEYWORD_MINIMUM_SCORE,
    new LocalKeywordSopSource(
      keywordIndexPath,
      chunkStorePath,
      DEFAULT_KEYWORD_MINIMUM_SCORE,
    ),
    cases,
  ),
  await evaluate(
    "TF-IDF Retrieval",
    DEFAULT_TFIDF_MINIMUM_SCORE,
    new LocalTfidfSopSource(
      tfidfIndexPath,
      chunkStorePath,
      DEFAULT_TFIDF_MINIMUM_SCORE,
    ),
    cases,
  ),
  await evaluate(
    "Embedding Retrieval",
    DEFAULT_EMBEDDING_MINIMUM_SCORE,
    new LocalEmbeddingSopSource(
      embeddingIndexPath,
      chunkStorePath,
      embedder,
      DEFAULT_EMBEDDING_MINIMUM_SCORE,
    ),
    cases,
  ),
];

for (const evaluation of evaluations) {
  printEvaluation(evaluation);
}

const report = createMarkdownReport(
  new Date().toISOString(),
  store,
  hash(evaluationCaseJson),
  embeddingIndex,
  evaluations,
);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, report, "utf8");
process.stdout.write(
  `Report: ${reportPath}\n` +
    `Embedding model: ${DEFAULT_EMBEDDING_MODEL}@${DEFAULT_EMBEDDING_MODEL_REVISION}\n`,
);
