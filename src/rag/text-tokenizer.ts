import type { SopChunk } from "./chunk-store.js";

const STOP_TOKENS = new Set(["如何", "怎么", "应该", "处理", "需要", "持续"]);

export function tokenize(text: string): string[] {
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

export function chunkSearchText(chunk: SopChunk): string {
  return [chunk.documentTitle, chunk.headingPath.join(" > "), chunk.content].join("\n");
}
