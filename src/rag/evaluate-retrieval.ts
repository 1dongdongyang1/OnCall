import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SopSource } from "../data-sources/sop-source.js";
import { buildChunkStore } from "./chunk-store.js";
import { HuggingFaceEmbedder } from "./embedder.js";
import {
  buildLocalEmbeddingIndex,
  LocalEmbeddingSopSource,
} from "./local-embedding-index.js";
import {
  buildLocalKeywordIndex,
  LocalKeywordSopSource,
} from "./local-keyword-index.js";
import {
  buildLocalTfidfIndex,
  LocalTfidfSopSource,
} from "./local-tfidf-index.js";

type EvaluationCase = {
  id: string;
  query: string;
  expectedDocumentIds: string[];
  expectedEvidence: string;
  decisionRule: string;
};

type Metrics = { recallAt1: number; recallAt3: number; noMatchAccuracy: number };

async function evaluate(source: SopSource, cases: EvaluationCase[]): Promise<Metrics> {
  const positiveCases = cases.filter((item) => item.expectedDocumentIds.length > 0);
  const noMatchCases = cases.filter((item) => item.expectedDocumentIds.length === 0);
  let recallAt1 = 0;
  let recallAt3 = 0;
  let correctNoMatches = 0;

  for (const item of positiveCases) {
    const results = await source.search(item.query, 3);
    const ids = results.map((result) => result.documentId);
    recallAt1 += item.expectedDocumentIds.filter((id) => ids.slice(0, 1).includes(id)).length /
      item.expectedDocumentIds.length;
    recallAt3 += item.expectedDocumentIds.filter((id) => ids.includes(id)).length /
      item.expectedDocumentIds.length;
  }

  for (const item of noMatchCases) {
    const results = await source.search(item.query, 3);
    if (results.length === 0) {
      correctNoMatches += 1;
    }
  }

  return {
    recallAt1: positiveCases.length ? recallAt1 / positiveCases.length : 0,
    recallAt3: positiveCases.length ? recallAt3 / positiveCases.length : 0,
    noMatchAccuracy: noMatchCases.length ? correctNoMatches / noMatchCases.length : 0,
  };
}

function formatMetric(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function printMetrics(name: string, metrics: Metrics): void {
  process.stdout.write(
    `${name}\n` +
      `Recall@1: ${formatMetric(metrics.recallAt1)}\n` +
      `Recall@3: ${formatMetric(metrics.recallAt3)}\n` +
      `No-match accuracy: ${formatMetric(metrics.noMatchAccuracy)}\n\n`,
  );
}

async function printRankings(
  name: string,
  source: SopSource,
  cases: EvaluationCase[],
): Promise<void> {
  process.stdout.write(`${name} rankings\n`);
  for (const item of cases) {
    const results = await source.search(item.query, 3);
    process.stdout.write(
      `${item.id}: ${results
        .map(
          (result) =>
            `${result.documentId}/${result.chunkId}=${result.score.toFixed(4)}`,
        )
        .join(", ") || "NO_MATCH"}\n`,
    );
  }
  process.stdout.write("\n");
}

const sopDirectory = resolve("sops");
const chunkStorePath = resolve(".rag-index", "sop-chunks.json");
const keywordIndexPath = resolve(".rag-index", "sop-keyword-index.json");
const tfidfIndexPath = resolve(".rag-index", "sop-tfidf-index.json");
const embeddingIndexPath = resolve(".rag-index", "sop-embedding-index.json");
const cases = JSON.parse(
  await readFile(resolve("src", "rag", "retrieval-eval-cases.json"), "utf8"),
) as EvaluationCase[];

await buildChunkStore(sopDirectory, chunkStorePath);
await buildLocalKeywordIndex(chunkStorePath, keywordIndexPath);
await buildLocalTfidfIndex(chunkStorePath, tfidfIndexPath);
const embedder = new HuggingFaceEmbedder();
await buildLocalEmbeddingIndex(chunkStorePath, embeddingIndexPath, embedder);
const keywordSource = new LocalKeywordSopSource(keywordIndexPath);
const tfidfSource = new LocalTfidfSopSource(tfidfIndexPath);
const embeddingSource = new LocalEmbeddingSopSource(embeddingIndexPath, embedder);
const keywordMetrics = await evaluate(keywordSource, cases);
const tfidfMetrics = await evaluate(tfidfSource, cases);
const embeddingMetrics = await evaluate(embeddingSource, cases);

printMetrics("Keyword Retrieval", keywordMetrics);
printMetrics("TF-IDF Retrieval", tfidfMetrics);
printMetrics("Embedding Retrieval", embeddingMetrics);

if (process.argv.includes("--details")) {
  await printRankings("Keyword Retrieval", keywordSource, cases);
  await printRankings("TF-IDF Retrieval", tfidfSource, cases);
  await printRankings("Embedding Retrieval", embeddingSource, cases);
  await printRankings(
    "Embedding Retrieval raw scores",
    new LocalEmbeddingSopSource(embeddingIndexPath, embedder, -1),
    cases,
  );
}
