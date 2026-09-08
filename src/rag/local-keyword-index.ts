import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SopSearchResult, SopSource } from "../data-sources/sop-source.js";
import { loadChunkStore, type SopChunk } from "./chunk-store.js";
import { chunkSearchText, tokenize } from "./text-tokenizer.js";

export type LocalKeywordIndex = {
  formatVersion: 1;
  kind: "keyword";
  chunkStoreHash: string;
  chunks: SopChunk[];
  postings: Record<string, string[]>;
};

export async function buildLocalKeywordIndex(
  chunkStorePath: string,
  indexPath: string,
): Promise<LocalKeywordIndex> {
  const store = await loadChunkStore(chunkStorePath);
  const postings = new Map<string, Set<string>>();

  for (const chunk of store.chunks) {
    for (const token of new Set(tokenize(chunkSearchText(chunk)))) {
      const chunkIds = postings.get(token) ?? new Set<string>();
      chunkIds.add(chunk.chunkId);
      postings.set(token, chunkIds);
    }
  }

  const index: LocalKeywordIndex = {
    formatVersion: 1,
    kind: "keyword",
    chunkStoreHash: store.corpusHash,
    chunks: store.chunks,
    postings: Object.fromEntries(
      [...postings.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([token, chunkIds]) => [token, [...chunkIds].sort()]),
    ),
  };
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

export class LocalKeywordSopSource implements SopSource {
  private index: LocalKeywordIndex | undefined;

  constructor(
    private readonly indexPath: string,
    private readonly minimumScore = 10,
  ) {}

  private async loadIndex(): Promise<LocalKeywordIndex> {
    this.index ??= JSON.parse(await readFile(this.indexPath, "utf8")) as LocalKeywordIndex;
    return this.index;
  }

  async search(query: string, limit = 3): Promise<SopSearchResult[]> {
    const index = await this.loadIndex();
    const queryTokens = [...new Set(tokenize(query))];
    const scores = new Map<string, number>();

    for (const token of queryTokens) {
      for (const chunkId of index.postings[token] ?? []) {
        scores.set(chunkId, (scores.get(chunkId) ?? 0) + token.length);
      }
    }

    return index.chunks
      .flatMap((chunk) => {
        const score = scores.get(chunk.chunkId) ?? 0;
        return score >= this.minimumScore ? [{ ...chunk, score }] : [];
      })
      .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId))
      .slice(0, Math.max(0, limit));
  }
}
