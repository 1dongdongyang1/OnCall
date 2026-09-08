import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SopSearchResult, SopSource } from "../data-sources/sop-source.js";
import { loadChunkStore, type SopChunk } from "./chunk-store.js";
import type { Embedder } from "./embedder.js";
import { chunkSearchText } from "./text-tokenizer.js";

type IndexedEmbeddingChunk = SopChunk & { vector: number[] };

export type LocalEmbeddingIndex = {
  formatVersion: 2;
  kind: "embedding";
  chunkStoreHash: string;
  modelId: string;
  modelRevision: string;
  dimensions: number;
  chunks: IndexedEmbeddingChunk[];
};

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error(`向量维度不一致：${left.length} != ${right.length}`);
  }
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

export async function buildLocalEmbeddingIndex(
  chunkStorePath: string,
  indexPath: string,
  embedder: Embedder,
): Promise<LocalEmbeddingIndex> {
  const store = await loadChunkStore(chunkStorePath);
  const vectors = await embedder.embed(store.chunks.map(chunkSearchText));
  const dimensions = vectors[0]?.length ?? 0;
  if (
    vectors.length !== store.chunks.length ||
    dimensions === 0 ||
    vectors.some((vector) => vector.length !== dimensions)
  ) {
    throw new Error("无法构建索引：Embedding 数量或维度与 Chunk 不一致");
  }

  const index: LocalEmbeddingIndex = {
    formatVersion: 2,
    kind: "embedding",
    chunkStoreHash: store.corpusHash,
    modelId: embedder.modelId,
    modelRevision: embedder.modelRevision,
    dimensions,
    chunks: store.chunks.map((chunk, index) => ({
      ...chunk,
      vector: vectors[index] ?? [],
    })),
  };
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

export class LocalEmbeddingSopSource implements SopSource {
  private index: LocalEmbeddingIndex | undefined;

  constructor(
    private readonly indexPath: string,
    private readonly embedder: Embedder,
    private readonly minimumScore = 0.42,
  ) {}

  private async loadIndex(): Promise<LocalEmbeddingIndex> {
    this.index ??= JSON.parse(await readFile(this.indexPath, "utf8")) as LocalEmbeddingIndex;
    if (
      this.index.modelId !== this.embedder.modelId ||
      this.index.modelRevision !== this.embedder.modelRevision
    ) {
      throw new Error("Embedding 索引所用模型与当前 Embedder 不一致，请重建索引");
    }
    return this.index;
  }

  async search(query: string, limit = 3): Promise<SopSearchResult[]> {
    const index = await this.loadIndex();
    const [queryVector] = await this.embedder.embed([query]);
    if (!queryVector) {
      return [];
    }
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
