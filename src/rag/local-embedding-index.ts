import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadSopDocuments } from "../data-sources/markdown-sop-source.js";
import type { Sop, SopSearchResult, SopSource } from "../data-sources/sop-source.js";
import type { Embedder } from "./embedder.js";
import { sopDocumentContent } from "./sop-document-content.js";

type IndexedEmbeddingDocument = Sop & { vector: number[] };

export type LocalEmbeddingIndex = {
  formatVersion: 1;
  kind: "embedding";
  corpusHash: string;
  modelId: string;
  modelRevision: string;
  dimensions: number;
  documents: IndexedEmbeddingDocument[];
};

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error(`向量维度不一致：${left.length} != ${right.length}`);
  }
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

export async function buildLocalEmbeddingIndex(
  sopDirectory: string,
  indexPath: string,
  embedder: Embedder,
): Promise<LocalEmbeddingIndex> {
  const documents = await loadSopDocuments(sopDirectory);
  const vectors = await embedder.embed(documents.map(sopDocumentContent));
  const dimensions = vectors[0]?.length ?? 0;

  if (
    vectors.length !== documents.length ||
    dimensions === 0 ||
    vectors.some((vector) => vector.length !== dimensions)
  ) {
    throw new Error("无法构建索引：Embedding 数量或维度与 SOP 文档不一致");
  }

  const index: LocalEmbeddingIndex = {
    formatVersion: 1,
    kind: "embedding",
    corpusHash: createHash("sha256")
      .update(JSON.stringify(documents))
      .digest("hex"),
    modelId: embedder.modelId,
    modelRevision: embedder.modelRevision,
    dimensions,
    documents: documents.map((document, index) => ({
      ...document,
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
    private readonly minimumScore = 0.35,
  ) {}

  private async loadIndex(): Promise<LocalEmbeddingIndex> {
    if (!this.index) {
      this.index = JSON.parse(
        await readFile(this.indexPath, "utf8"),
      ) as LocalEmbeddingIndex;
      if (
        this.index.modelId !== this.embedder.modelId ||
        this.index.modelRevision !== this.embedder.modelRevision
      ) {
        throw new Error("Embedding 索引所用模型与当前 Embedder 不一致，请重建索引");
      }
    }
    return this.index;
  }

  async search(query: string, limit = 3): Promise<SopSearchResult[]> {
    const index = await this.loadIndex();
    const [queryVector] = await this.embedder.embed([query]);
    if (!queryVector) {
      return [];
    }

    return index.documents
      .map(({ vector, ...document }): SopSearchResult => ({
        ...document,
        score: cosineSimilarity(queryVector, vector),
      }))
      .filter((document) => document.score >= this.minimumScore)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, Math.max(0, limit));
  }
}
