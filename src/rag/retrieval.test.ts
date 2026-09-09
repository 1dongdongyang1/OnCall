import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildChunkStore, diffChunkStores } from "./chunk-store.js";
import type { Embedder } from "./embedder.js";
import {
  buildLocalEmbeddingIndex,
  LocalEmbeddingSopSource,
} from "./local-embedding-index.js";
import {
  buildLocalKeywordIndex,
  LocalKeywordSopSource,
} from "./local-keyword-index.js";
import { buildLocalTfidfIndex, LocalTfidfSopSource } from "./local-tfidf-index.js";

class DeterministicTestEmbedder implements Embedder {
  readonly modelId = "deterministic-test-embedder";
  readonly modelRevision = "1";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      if (/磁盘|根分区|app\.log/i.test(text)) {
        return [1, 0, 0];
      }
      if (/内存|oom/i.test(text)) {
        return [0, 1, 0];
      }
      return [0, 0, 1];
    });
  }
}

test("三套索引消费同一份 Chunk 数据并保留稳定元数据", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oncall-rag-test-"));
  const chunkStorePath = join(temporaryDirectory, "chunks.json");
  const keywordPath = join(temporaryDirectory, "keyword.json");
  const tfidfPath = join(temporaryDirectory, "tfidf.json");
  const embeddingPath = join(temporaryDirectory, "embedding.json");
  const embedder = new DeterministicTestEmbedder();

  try {
    const store = await buildChunkStore(resolve("sops"), chunkStorePath);
    const keywordIndex = await buildLocalKeywordIndex(chunkStorePath, keywordPath);
    const tfidfIndex = await buildLocalTfidfIndex(chunkStorePath, tfidfPath);
    const embeddingIndex = await buildLocalEmbeddingIndex(
      chunkStorePath,
      embeddingPath,
      embedder,
    );

    assert.equal(keywordIndex.chunkStoreHash, store.corpusHash);
    assert.equal(tfidfIndex.chunkStoreHash, store.corpusHash);
    assert.equal(embeddingIndex.chunkStoreHash, store.corpusHash);
    assert.deepEqual(keywordIndex.chunks, store.chunks);
    assert.deepEqual(
      tfidfIndex.chunks.map(({ vector: _vector, ...chunk }) => chunk),
      store.chunks,
    );
    assert.deepEqual(
      embeddingIndex.chunks.map(({ vector: _vector, ...chunk }) => chunk),
      store.chunks,
    );

    const keywordResults = await new LocalKeywordSopSource(
      keywordPath,
      chunkStorePath,
      0,
    ).search(
      "磁盘使用率过高",
      3,
    );
    const tfidfResults = await new LocalTfidfSopSource(
      tfidfPath,
      chunkStorePath,
      0,
    ).search(
      "根分区空间不足",
      3,
    );
    const embeddingResults = await new LocalEmbeddingSopSource(
      embeddingPath,
      chunkStorePath,
      embedder,
      0.5,
    ).search("根分区空间不足", 3);

    for (const results of [keywordResults, tfidfResults, embeddingResults]) {
      assert.ok(results.length > 0);
      const result = results[0];
      assert.match(result?.documentId ?? "", /^doc-[a-f0-9]{20}$/);
      assert.match(result?.chunkId ?? "", /^chunk-[a-f0-9]{24}$/);
      assert.ok((result?.headingPath.length ?? 0) > 0);
      assert.ok((result?.content.length ?? 0) > 0);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("相同语料可重复构建完全一致的 ChunkStore 和三套索引", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oncall-rag-repeat-"));
  const firstChunks = join(temporaryDirectory, "chunks-first.json");
  const secondChunks = join(temporaryDirectory, "chunks-second.json");
  const firstIndex = join(temporaryDirectory, "tfidf-first.json");
  const secondIndex = join(temporaryDirectory, "tfidf-second.json");
  const firstKeyword = join(temporaryDirectory, "keyword-first.json");
  const secondKeyword = join(temporaryDirectory, "keyword-second.json");
  const firstEmbedding = join(temporaryDirectory, "embedding-first.json");
  const secondEmbedding = join(temporaryDirectory, "embedding-second.json");
  const embedder = new DeterministicTestEmbedder();

  try {
    await buildChunkStore(resolve("sops"), firstChunks);
    await buildChunkStore(resolve("sops"), secondChunks);
    await buildLocalTfidfIndex(firstChunks, firstIndex);
    await buildLocalTfidfIndex(secondChunks, secondIndex);
    await buildLocalKeywordIndex(firstChunks, firstKeyword);
    await buildLocalKeywordIndex(secondChunks, secondKeyword);
    await buildLocalEmbeddingIndex(firstChunks, firstEmbedding, embedder);
    await buildLocalEmbeddingIndex(secondChunks, secondEmbedding, embedder);
    assert.equal(await readFile(firstChunks, "utf8"), await readFile(secondChunks, "utf8"));
    assert.equal(await readFile(firstIndex, "utf8"), await readFile(secondIndex, "utf8"));
    assert.equal(await readFile(firstKeyword, "utf8"), await readFile(secondKeyword, "utf8"));
    assert.equal(
      await readFile(firstEmbedding, "utf8"),
      await readFile(secondEmbedding, "utf8"),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("文档改名不改变 ID，新增或修改内容只改变对应 Chunk ID", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oncall-chunk-id-"));
  const sourceDirectory = join(temporaryDirectory, "sops");
  const sourcePath = join(sourceDirectory, "first-name.md");
  const renamedPath = join(sourceDirectory, "renamed.md");
  await mkdir(sourceDirectory);

  try {
    await writeFile(
      sourcePath,
      "# 稳定标题\n\n## 固定章节\n\n固定内容。\n\n## 可变章节\n\n原始内容。\n",
      "utf8",
    );
    const first = await buildChunkStore(sourceDirectory, join(temporaryDirectory, "one.json"));
    await rename(sourcePath, renamedPath);
    const renamed = await buildChunkStore(sourceDirectory, join(temporaryDirectory, "two.json"));

    assert.equal(first.documents[0]?.documentId, renamed.documents[0]?.documentId);
    assert.deepEqual(
      first.chunks.map((chunk) => chunk.chunkId),
      renamed.chunks.map((chunk) => chunk.chunkId),
    );
    assert.notEqual(first.documents[0]?.sourcePath, renamed.documents[0]?.sourcePath);

    await writeFile(
      renamedPath,
      "# 稳定标题\n\n## 新增章节\n\n新增内容。\n\n## 固定章节\n\n固定内容。\n\n## 可变章节\n\n修改后的内容。\n",
      "utf8",
    );
    const changed = await buildChunkStore(sourceDirectory, join(temporaryDirectory, "three.json"));
    const diff = diffChunkStores(renamed, changed);
    const fixedChunkId = first.chunks.find((chunk) => chunk.content === "固定内容。")?.chunkId;
    const originalVariableId = first.chunks.find(
      (chunk) => chunk.content === "原始内容。",
    )?.chunkId;

    assert.equal(first.documents[0]?.documentId, changed.documents[0]?.documentId);
    assert.ok(changed.chunks.some((chunk) => chunk.chunkId === fixedChunkId));
    assert.ok(!changed.chunks.some((chunk) => chunk.chunkId === originalVariableId));
    assert.ok(changed.chunks.some((chunk) => chunk.content === "新增内容。"));
    assert.ok(changed.chunks.some((chunk) => chunk.content === "修改后的内容。"));
    assert.equal(diff.addedChunkIds.length, 2);
    assert.equal(diff.removedChunkIds.length, 1);
    assert.equal(diff.unchangedChunkIds.length, 1);
    assert.equal(diff.changedLocations.length, 1);
    assert.deepEqual(diff.changedLocations[0]?.headingPath, ["稳定标题", "可变章节"]);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("新增和删除文档会稳定反映为对应的 Document 与 Chunk 变化", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oncall-doc-diff-"));
  const sourceDirectory = join(temporaryDirectory, "sops");
  const firstPath = join(sourceDirectory, "first.md");
  const secondPath = join(sourceDirectory, "second.md");
  await mkdir(sourceDirectory);

  try {
    await writeFile(firstPath, "# 第一份 SOP\n\n## 排查\n\n第一份证据。\n", "utf8");
    const initial = await buildChunkStore(
      sourceDirectory,
      join(temporaryDirectory, "initial.json"),
    );
    await writeFile(secondPath, "# 第二份 SOP\n\n## 排查\n\n第二份证据。\n", "utf8");
    const added = await buildChunkStore(
      sourceDirectory,
      join(temporaryDirectory, "added.json"),
    );
    const addDiff = diffChunkStores(initial, added);
    const secondDocumentId = added.documents.find(
      (document) => document.title === "第二份 SOP",
    )?.documentId;
    assert.equal(added.documents.length, 2);
    assert.equal(addDiff.addedChunkIds.length, 1);
    assert.equal(addDiff.removedChunkIds.length, 0);
    assert.ok(
      added.chunks.some((chunk) => chunk.documentId === secondDocumentId),
    );

    await rm(firstPath);
    const removed = await buildChunkStore(
      sourceDirectory,
      join(temporaryDirectory, "removed.json"),
    );
    const removeDiff = diffChunkStores(added, removed);
    assert.deepEqual(
      removed.documents.map((document) => document.title),
      ["第二份 SOP"],
    );
    assert.equal(removeDiff.addedChunkIds.length, 0);
    assert.equal(removeDiff.removedChunkIds.length, 1);
    assert.equal(removeDiff.unchangedChunkIds.length, 1);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("标题层级允许跳级且 fenced code 中的井号不会成为标题", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oncall-headings-"));
  const sourceDirectory = join(temporaryDirectory, "sops");
  await mkdir(sourceDirectory);

  try {
    await writeFile(
      join(sourceDirectory, "headings.md"),
      "# 层级测试\n\n开场。\n\n```bash\n# 这是 shell 注释\necho ok\n```\n\n### 跳级章节\n\n跳级内容。\n\n#### 子章节\n\n子级内容。\n\n## 同级重置\n\n重置内容。\n",
      "utf8",
    );
    const store = await buildChunkStore(
      sourceDirectory,
      join(temporaryDirectory, "chunks.json"),
    );
    const headingsByContent = new Map(
      store.chunks.map((chunk) => [chunk.content, chunk.headingPath]),
    );
    assert.deepEqual(headingsByContent.get("跳级内容。"), [
      "层级测试",
      "跳级章节",
    ]);
    assert.deepEqual(headingsByContent.get("子级内容。"), [
      "层级测试",
      "跳级章节",
      "子章节",
    ]);
    assert.deepEqual(headingsByContent.get("重置内容。"), [
      "层级测试",
      "同级重置",
    ]);
    assert.ok(
      store.chunks.every(
        (chunk) => !chunk.headingPath.includes("这是 shell 注释"),
      ),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("只有一级标题的空 SOP 被保留，无一级标题的空文件被拒绝", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oncall-empty-"));
  const sourceDirectory = join(temporaryDirectory, "sops");
  const emptyPath = join(sourceDirectory, "empty.md");
  await mkdir(sourceDirectory);

  try {
    await writeFile(emptyPath, "# 仅标题 SOP\n", "utf8");
    const titleOnly = await buildChunkStore(
      sourceDirectory,
      join(temporaryDirectory, "title-only.json"),
    );
    assert.equal(titleOnly.documents.length, 1);
    assert.equal(titleOnly.chunks.length, 0);

    await writeFile(emptyPath, "\n", "utf8");
    await assert.rejects(
      buildChunkStore(sourceDirectory, join(temporaryDirectory, "invalid.json")),
      /缺少一级标题/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("索引与当前 ChunkStore 不一致或元数据丢失时拒绝检索", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oncall-stale-index-"));
  const sourceDirectory = join(temporaryDirectory, "sops");
  const chunkStorePath = join(temporaryDirectory, "chunks.json");
  const keywordPath = join(temporaryDirectory, "keyword.json");
  const tfidfPath = join(temporaryDirectory, "tfidf.json");
  const embeddingPath = join(temporaryDirectory, "embedding.json");
  const embedder = new DeterministicTestEmbedder();
  await mkdir(sourceDirectory);

  try {
    await writeFile(
      join(sourceDirectory, "disk.md"),
      "# 磁盘 SOP\n\n## 排查\n\n检查根分区。\n",
      "utf8",
    );
    await buildChunkStore(sourceDirectory, chunkStorePath);
    await buildLocalKeywordIndex(chunkStorePath, keywordPath);
    await buildLocalTfidfIndex(chunkStorePath, tfidfPath);
    await buildLocalEmbeddingIndex(chunkStorePath, embeddingPath, embedder);

    await writeFile(
      join(sourceDirectory, "disk.md"),
      "# 磁盘 SOP\n\n## 排查\n\n检查根分区和 inode。\n",
      "utf8",
    );
    await buildChunkStore(sourceDirectory, chunkStorePath);

    await assert.rejects(
      new LocalKeywordSopSource(keywordPath, chunkStorePath, 0).search("磁盘"),
      /索引已过期/,
    );
    await assert.rejects(
      new LocalTfidfSopSource(tfidfPath, chunkStorePath, 0).search("磁盘"),
      /索引已过期/,
    );
    await assert.rejects(
      new LocalEmbeddingSopSource(
        embeddingPath,
        chunkStorePath,
        embedder,
        0,
      ).search("磁盘"),
      /索引已过期/,
    );

    const brokenStore = JSON.parse(
      await readFile(chunkStorePath, "utf8"),
    ) as { chunks: Array<Record<string, unknown>> };
    delete brokenStore.chunks[0]?.contentHash;
    await writeFile(chunkStorePath, JSON.stringify(brokenStore), "utf8");
    await assert.rejects(
      new LocalKeywordSopSource(keywordPath, chunkStorePath, 0).search("磁盘"),
      /Chunk 元数据或身份无效/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
