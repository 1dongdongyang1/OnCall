import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Sop, SopSearchResult, SopSource } from "./sop-source.js";

function readMetadata(frontmatter: string): Map<string, string> {
  return new Map(
    frontmatter.split(/\r?\n/).flatMap((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex < 0) {
        return [];
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      return [[key, value]];
    }),
  );
}

export function parseSop(fileName: string, markdown: string): Sop {
  const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const titleMatch = markdown.match(/^#\s+(.+)$/m);

  if (!frontmatterMatch || !titleMatch) {
    throw new Error(`SOP 文档格式错误：${fileName}`);
  }

  const metadata = readMetadata(frontmatterMatch[1]);
  const id = metadata.get("id");
  const keywords = metadata
    .get("keywords")
    ?.split(",")
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
  const steps = markdown
    .split(/\r?\n/)
    .flatMap((line) => {
      const stepMatch = line.match(/^\d+\.\s+(.+)$/);
      return stepMatch ? [stepMatch[1]] : [];
    });

  if (!id || !keywords?.length || !steps.length) {
    throw new Error(`SOP 文档缺少 id、keywords 或处理步骤：${fileName}`);
  }

  return {
    id,
    title: titleMatch[1].trim(),
    keywords,
    steps,
    sourcePath: fileName,
  };
}

export async function loadSopDocuments(directory: string): Promise<Sop[]> {
  const fileNames = (await readdir(directory))
    .filter((fileName) => fileName.endsWith(".md"))
    .sort();

  return Promise.all(
    fileNames.map(async (fileName) =>
      parseSop(fileName, await readFile(join(directory, fileName), "utf8")),
    ),
  );
}

export class MarkdownSopSource implements SopSource {
  constructor(private readonly directory: string) {}

  async search(query: string, limit = 3): Promise<SopSearchResult[]> {
    const normalizedQuery = query.toLowerCase();
    const documents = await loadSopDocuments(this.directory);

    return documents
      .map((document): SopSearchResult => {
        const matches = document.keywords.filter((keyword) =>
          normalizedQuery.includes(keyword),
        );
        const score = matches.reduce(
          (total, keyword) => total + 1 + keyword.length / 100,
          0,
        );
        return { ...document, score };
      })
      .filter((document) => document.score > 0)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, Math.max(0, limit));
  }
}
