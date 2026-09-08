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
    assert.deepEqual(
      keywordIndex.chunks.map((chunk) => chunk.chunkId).sort(),
      tfidfIndex.chunks.map((chunk) => chunk.chunkId).sort(),
    );
    assert.deepEqual(
      keywordIndex.chunks.map((chunk) => chunk.chunkId).sort(),
      embeddingIndex.chunks.map((chunk) => chunk.chunkId).sort(),
    );

    const keywordResults = await new LocalKeywordSopSource(keywordPath, 0).search(
      "磁盘使用率过高",
      3,
    );
    const tfidfResults = await new LocalTfidfSopSource(tfidfPath, 0).search(
      "根分区空间不足",
      3,
    );
    const embeddingResults = await new LocalEmbeddingSopSource(
      embeddingPath,
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

test("相同源文件可重复构建完全一致的 Chunk 数据和 TF-IDF 索引", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oncall-rag-repeat-"));
  const firstChunks = join(temporaryDirectory, "chunks-first.json");
  const secondChunks = join(temporaryDirectory, "chunks-second.json");
  const firstIndex = join(temporaryDirectory, "tfidf-first.json");
  const secondIndex = join(temporaryDirectory, "tfidf-second.json");

  try {
    await buildChunkStore(resolve("sops"), firstChunks);
    await buildChunkStore(resolve("sops"), secondChunks);
    await buildLocalTfidfIndex(firstChunks, firstIndex);
    await buildLocalTfidfIndex(secondChunks, secondIndex);
    assert.equal(await readFile(firstChunks, "utf8"), await readFile(secondChunks, "utf8"));
    assert.equal(await readFile(firstIndex, "utf8"), await readFile(secondIndex, "utf8"));
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
