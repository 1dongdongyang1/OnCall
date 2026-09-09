import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SopSearchResult, SopSource } from "../data-sources/sop-source.js";
import { loadChunkStore, type SopChunk } from "./chunk-store.js";
import { chunkSearchText, tokenize } from "./text-tokenizer.js";
import { assertIndexMatchesChunkStore } from "./index-integrity.js";

type IndexedChunk = SopChunk & { vector: number[] };

export type LocalTfidfIndex = {
  formatVersion: 2;
  kind: "tfidf";
  chunkStoreHash: string;
  vocabulary: string[];
  idf: number[];
  chunks: IndexedChunk[];
};

export const DEFAULT_TFIDF_MINIMUM_SCORE = 0.2;

function createVector(tokens: string[], vocabulary: string[], idf: number[]): number[] {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const values = vocabulary.map((term, index) => (counts.get(term) ?? 0) * idf[index]);
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? values : values.map((value) => value / norm);
}

function cosineSimilarity(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

export async function buildLocalTfidfIndex(
  chunkStorePath: string,
  indexPath: string,
): Promise<LocalTfidfIndex> {
  const store = await loadChunkStore(chunkStorePath);
  const tokenSets = store.chunks.map((chunk) => tokenize(chunkSearchText(chunk)));
  const vocabulary = [...new Set(tokenSets.flat())].sort();
  const idf = vocabulary.map((term) => {
    const frequency = tokenSets.filter((tokens) => tokens.includes(term)).length;
    return Math.log((1 + store.chunks.length) / (1 + frequency)) + 1;
  });
  const index: LocalTfidfIndex = {
    formatVersion: 2,
    kind: "tfidf",
    chunkStoreHash: store.corpusHash,
    vocabulary,
    idf,
    chunks: store.chunks.map((chunk, chunkIndex) => ({
      ...chunk,
      vector: createVector(tokenSets[chunkIndex] ?? [], vocabulary, idf),
    })),
  };

  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

export class LocalTfidfSopSource implements SopSource {
  private index: LocalTfidfIndex | undefined;

  constructor(
    private readonly indexPath: string,
    private readonly chunkStorePath: string,
    private readonly minimumScore = DEFAULT_TFIDF_MINIMUM_SCORE,
  ) {}

  private async loadIndex(): Promise<LocalTfidfIndex> {
    this.index ??= JSON.parse(await readFile(this.indexPath, "utf8")) as LocalTfidfIndex;
    if (
      this.index.kind !== "tfidf" ||
      this.index.formatVersion !== 2 ||
      this.index.vocabulary.length !== this.index.idf.length ||
      this.index.chunks.some(
        (chunk) => chunk.vector.length !== this.index?.vocabulary.length,
      )
    ) {
      throw new Error("TF-IDF 索引格式或向量维度无效，请重建索引");
    }
    await assertIndexMatchesChunkStore(
      "TF-IDF",
      this.chunkStorePath,
      this.index.chunkStoreHash,
      this.index.chunks,
    );
    return this.index;
  }

  async search(query: string, limit = 3): Promise<SopSearchResult[]> {
    const index = await this.loadIndex();
    const queryVector = createVector(tokenize(query), index.vocabulary, index.idf);
    return index.chunks
      .map(({ vector, ...chunk }): SopSearchResult => ({
        ...chunk,
        score: cosineSimilarity(queryVector, vector),
      }))
      .filter((chunk) => chunk.score >= this.minimumScore)
      .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId))
      .slice(0, Math.max(0, limit));
  }
}
