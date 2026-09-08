import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Sop, SopSource } from "./sop-source.js";

type IndexedSop = Sop & {
  keywords: string[];
};

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

function parseSop(fileName: string, markdown: string): IndexedSop {
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
  };
}

export class MarkdownSopSource implements SopSource {
  constructor(private readonly directory: string) {}

  async findByQuery(query: string): Promise<Sop | null> {
    const fileNames = (await readdir(this.directory))
      .filter((fileName) => fileName.endsWith(".md"))
      .sort();
    const normalizedQuery = query.toLowerCase();

    for (const fileName of fileNames) {
      const markdown = await readFile(join(this.directory, fileName), "utf8");
      const sop = parseSop(fileName, markdown);

      if (sop.keywords.some((keyword) => normalizedQuery.includes(keyword))) {
        return {
          id: sop.id,
          title: sop.title,
          steps: sop.steps,
        };
      }
    }

    return null;
  }
}
