import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Sop, SopSearchResult, SopSource } from "../data-sources/sop-source.js";
import { loadSopDocuments } from "../data-sources/markdown-sop-source.js";

type IndexedDocument = Sop & { vector: number[] };

const STOP_TOKENS = new Set(["如何", "怎么", "应该", "处理", "需要", "持续"]);

export type LocalVectorIndex = {
  formatVersion: 1;
  corpusHash: string;
  vocabulary: string[];
  idf: number[];
  documents: IndexedDocument[];
};

function tokenize(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  const segments = normalized.match(/[a-z0-9]+|[\p{Script=Han}]+/gu) ?? [];
  const tokens: string[] = [];

  for (const segment of segments) {
    if (/^[a-z0-9]+$/.test(segment)) {
      tokens.push(segment);
      continue;
    }

    const characters = [...segment];
    if (characters.length === 1) {
      tokens.push(segment);
    }
    for (let index = 0; index < characters.length - 1; index += 1) {
      tokens.push(characters.slice(index, index + 2).join(""));
    }
    for (let index = 0; index < characters.length - 2; index += 1) {
      tokens.push(characters.slice(index, index + 3).join(""));
    }
  }

  return tokens.filter((token) => !STOP_TOKENS.has(token));
}

function documentText(document: Sop): string {
  return [
    document.id,
    document.title,
    document.keywords.join(" "),
    document.steps.join(" "),
  ].join("\n");
}

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

export async function buildLocalVectorIndex(
  sopDirectory: string,
  indexPath: string,
): Promise<LocalVectorIndex> {
  const documents = await loadSopDocuments(sopDirectory);
  const tokenSets = documents.map((document) => tokenize(documentText(document)));
  const vocabulary = [...new Set(tokenSets.flat())].sort();
  const idf = vocabulary.map((term) => {
    const documentFrequency = tokenSets.filter((tokens) => tokens.includes(term)).length;
    return Math.log((1 + documents.length) / (1 + documentFrequency)) + 1;
  });
  const corpusHash = createHash("sha256")
    .update(JSON.stringify(documents))
    .digest("hex");
  const index: LocalVectorIndex = {
    formatVersion: 1,
    corpusHash,
    vocabulary,
    idf,
    documents: documents.map((document, documentIndex) => ({
      ...document,
      vector: createVector(tokenSets[documentIndex] ?? [], vocabulary, idf),
    })),
  };

  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

export class LocalVectorSopSource implements SopSource {
  private index: LocalVectorIndex | undefined;

  constructor(
    private readonly indexPath: string,
    private readonly minimumScore = 0.04,
  ) {}

  private async loadIndex(): Promise<LocalVectorIndex> {
    if (!this.index) {
      this.index = JSON.parse(await readFile(this.indexPath, "utf8")) as LocalVectorIndex;
    }
    return this.index;
  }

  async search(query: string, limit = 3): Promise<SopSearchResult[]> {
    const index = await this.loadIndex();
    const queryVector = createVector(tokenize(query), index.vocabulary, index.idf);

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
