import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SourceDocument = {
  documentId: string;
  title: string;
  sourcePath: string;
  contentHash: string;
};

export type SopChunk = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourcePath: string;
  headingPath: string[];
  content: string;
  contentHash: string;
};

export type ChunkStore = {
  formatVersion: 1;
  chunking: {
    strategy: "markdown-heading-paragraph";
    maxCharacters: number;
  };
  corpusHash: string;
  documents: SourceDocument[];
  chunks: SopChunk[];
};

export type ChunkStoreDiff = {
  addedChunkIds: string[];
  removedChunkIds: string[];
  unchangedChunkIds: string[];
  changedLocations: Array<{
    documentId: string;
    headingPath: string[];
    previousChunkIds: string[];
    currentChunkIds: string[];
  }>;
};

const DEFAULT_MAX_CHARACTERS = 1400;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n/g, "\n").trim();
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function readTitle(sourcePath: string, markdown: string): string {
  let insideCodeFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      insideCodeFence = !insideCodeFence;
      continue;
    }
    const title = insideCodeFence ? undefined : line.match(/^#\s+(.+)$/)?.[1]?.trim();
    if (title) {
      return title;
    }
  }
  throw new Error(`SOP 文档缺少一级标题：${sourcePath}`);
}

function createDocumentId(title: string): string {
  return `doc-${hash(title.normalize("NFKC").trim().toLowerCase()).slice(0, 20)}`;
}

function splitOversizedText(text: string, maxCharacters: number): string[] {
  const pieces: string[] = [];
  for (let start = 0; start < text.length; start += maxCharacters) {
    pieces.push(text.slice(start, start + maxCharacters));
  }
  return pieces;
}

function packParagraphs(body: string, maxCharacters: number): string[] {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) =>
      paragraph.length > maxCharacters
        ? splitOversizedText(paragraph, maxCharacters)
        : [paragraph],
    );
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (current && candidate.length > maxCharacters) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function chunkDocument(
  sourcePath: string,
  markdown: string,
  maxCharacters: number,
): { document: SourceDocument; chunks: SopChunk[] } {
  const normalized = normalizeMarkdown(markdown);
  const content = stripFrontmatter(normalized);
  const title = readTitle(sourcePath, content);
  const documentId = createDocumentId(title);
  const document: SourceDocument = {
    documentId,
    title,
    sourcePath,
    contentHash: hash(normalized),
  };
  let headingPath: string[] = [];
  const headingsByLevel = new Map<number, string>();
  const sections: Array<{ headingPath: string[]; lines: string[] }> = [];
  let currentLines: string[] = [];
  let insideCodeFence = false;

  const flushSection = (): void => {
    const body = currentLines.join("\n").trim();
    if (body) {
      sections.push({ headingPath: [...headingPath], lines: currentLines });
    }
    currentLines = [];
  };

  for (const line of content.split("\n")) {
    const isCodeFence = /^\s*```/.test(line);
    const heading = insideCodeFence ? null : line.match(/^(#{1,6})\s+(.+)$/);
    if (!heading) {
      currentLines.push(line);
      if (isCodeFence) {
        insideCodeFence = !insideCodeFence;
      }
      continue;
    }

    flushSection();
    const level = heading[1]?.length ?? 1;
    const headingText = heading[2]?.trim() ?? "";
    for (const existingLevel of headingsByLevel.keys()) {
      if (existingLevel >= level) {
        headingsByLevel.delete(existingLevel);
      }
    }
    headingsByLevel.set(level, headingText);
    headingPath = [...headingsByLevel.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, text]) => text);
  }
  flushSection();

  const chunks = sections.flatMap((section) =>
    packParagraphs(section.lines.join("\n"), maxCharacters).map((body) => {
      const contentHash = hash(body);
      const identity = [documentId, section.headingPath.join(" > "), contentHash].join("\0");
      return {
        chunkId: `chunk-${hash(identity).slice(0, 24)}`,
        documentId,
        documentTitle: title,
        sourcePath,
        headingPath: section.headingPath,
        content: body,
        contentHash,
      };
    }),
  );

  return { document, chunks };
}

export async function buildChunkStore(
  sourceDirectory: string,
  outputPath: string,
  maxCharacters = DEFAULT_MAX_CHARACTERS,
): Promise<ChunkStore> {
  const sourcePaths = (await readdir(sourceDirectory))
    .filter((sourcePath) => sourcePath.endsWith(".md"))
    .sort();
  const parsed = await Promise.all(
    sourcePaths.map(async (sourcePath) =>
      chunkDocument(
        sourcePath,
        await readFile(join(sourceDirectory, sourcePath), "utf8"),
        maxCharacters,
      ),
    ),
  );
  const documents = parsed.map((item) => item.document).sort((a, b) =>
    a.documentId.localeCompare(b.documentId),
  );
  const chunks = parsed.flatMap((item) => item.chunks).sort((a, b) =>
    a.chunkId.localeCompare(b.chunkId),
  );

  if (new Set(documents.map((document) => document.documentId)).size !== documents.length) {
    throw new Error("存在相同顶级标题生成的重复 documentId，请为文档提供唯一标题");
  }
  if (new Set(chunks.map((chunk) => chunk.chunkId)).size !== chunks.length) {
    throw new Error("存在重复 chunkId，请检查同一标题路径下的重复内容");
  }

  const store: ChunkStore = {
    formatVersion: 1,
    chunking: {
      strategy: "markdown-heading-paragraph",
      maxCharacters,
    },
    corpusHash: hash(JSON.stringify({ documents, chunks })),
    documents,
    chunks,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  return store;
}

export async function loadChunkStore(path: string): Promise<ChunkStore> {
  const store = JSON.parse(await readFile(path, "utf8")) as ChunkStore;
  validateChunkStore(store);
  return store;
}

export function validateChunkStore(store: ChunkStore): void {
  if (
    store.formatVersion !== 1 ||
    store.chunking?.strategy !== "markdown-heading-paragraph" ||
    !Number.isInteger(store.chunking.maxCharacters) ||
    store.chunking.maxCharacters <= 0 ||
    !Array.isArray(store.documents) ||
    !Array.isArray(store.chunks)
  ) {
    throw new Error("ChunkStore 格式或分块配置无效");
  }

  const documentsById = new Map(store.documents.map((document) => [document.documentId, document]));
  if (documentsById.size !== store.documents.length) {
    throw new Error("ChunkStore 包含重复 documentId");
  }
  for (const document of store.documents) {
    if (
      document.documentId !== createDocumentId(document.title) ||
      !document.sourcePath ||
      !/^[a-f0-9]{64}$/.test(document.contentHash)
    ) {
      throw new Error(`ChunkStore 文档元数据无效：${document.documentId}`);
    }
  }

  const chunkIds = new Set<string>();
  for (const chunk of store.chunks) {
    const document = documentsById.get(chunk.documentId);
    const expectedContentHash = hash(chunk.content);
    const expectedChunkId = `chunk-${hash(
      [chunk.documentId, chunk.headingPath.join(" > "), expectedContentHash].join("\0"),
    ).slice(0, 24)}`;
    if (
      !document ||
      chunk.documentTitle !== document.title ||
      chunk.sourcePath !== document.sourcePath ||
      !Array.isArray(chunk.headingPath) ||
      chunk.headingPath.length === 0 ||
      chunk.headingPath.some((heading) => typeof heading !== "string" || !heading) ||
      !chunk.content ||
      chunk.contentHash !== expectedContentHash ||
      chunk.chunkId !== expectedChunkId
    ) {
      throw new Error(`ChunkStore Chunk 元数据或身份无效：${chunk.chunkId}`);
    }
    if (chunkIds.has(chunk.chunkId)) {
      throw new Error(`ChunkStore 包含重复 chunkId：${chunk.chunkId}`);
    }
    chunkIds.add(chunk.chunkId);
  }

  const expectedCorpusHash = hash(
    JSON.stringify({ documents: store.documents, chunks: store.chunks }),
  );
  if (store.corpusHash !== expectedCorpusHash) {
    throw new Error("ChunkStore corpusHash 与持久化内容不一致");
  }
}

function locationKey(chunk: SopChunk): string {
  return JSON.stringify([chunk.documentId, chunk.headingPath]);
}

export function diffChunkStores(
  previous: ChunkStore,
  current: ChunkStore,
): ChunkStoreDiff {
  const previousIds = new Set(previous.chunks.map((chunk) => chunk.chunkId));
  const currentIds = new Set(current.chunks.map((chunk) => chunk.chunkId));
  const previousLocations = new Map<string, SopChunk[]>();
  const currentLocations = new Map<string, SopChunk[]>();

  for (const chunk of previous.chunks) {
    previousLocations.set(locationKey(chunk), [
      ...(previousLocations.get(locationKey(chunk)) ?? []),
      chunk,
    ]);
  }
  for (const chunk of current.chunks) {
    currentLocations.set(locationKey(chunk), [
      ...(currentLocations.get(locationKey(chunk)) ?? []),
      chunk,
    ]);
  }

  const changedLocations = [...previousLocations.keys()]
    .filter((key) => currentLocations.has(key))
    .flatMap((key) => {
      const previousChunkIds = (previousLocations.get(key) ?? [])
        .map((chunk) => chunk.chunkId)
        .sort();
      const currentChunkIds = (currentLocations.get(key) ?? [])
        .map((chunk) => chunk.chunkId)
        .sort();
      if (JSON.stringify(previousChunkIds) === JSON.stringify(currentChunkIds)) {
        return [];
      }
      const [documentId, headingPath] = JSON.parse(key) as [string, string[]];
      return [{ documentId, headingPath, previousChunkIds, currentChunkIds }];
    })
    .sort((left, right) =>
      `${left.documentId}:${left.headingPath.join("/")}`.localeCompare(
        `${right.documentId}:${right.headingPath.join("/")}`,
      ),
    );

  return {
    addedChunkIds: [...currentIds].filter((id) => !previousIds.has(id)).sort(),
    removedChunkIds: [...previousIds].filter((id) => !currentIds.has(id)).sort(),
    unchangedChunkIds: [...currentIds].filter((id) => previousIds.has(id)).sort(),
    changedLocations,
  };
}
