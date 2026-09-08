import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { MarkdownSopSource } from "../data-sources/markdown-sop-source.js";
import type { Embedder } from "./embedder.js";
import {
  buildLocalEmbeddingIndex,
  LocalEmbeddingSopSource,
} from "./local-embedding-index.js";
import { buildLocalTfidfIndex, LocalTfidfSopSource } from "./local-tfidf-index.js";

class DeterministicTestEmbedder implements Embedder {
  readonly modelId = "deterministic-test-embedder";
  readonly modelRevision = "1";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      if (/磁盘|根分区|app\.log/i.test(text)) {
        return [1, 0, 0];
      }
      if (/xid|pcie|fallen off/i.test(text)) {
        return [0, 1, 0];
      }
      return [0, 0, 1];
    });
  }
}

test("关键词与向量检索都遵守 Top-K 接口并保留 SOP 元数据", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oncall-rag-test-"));
  const indexPath = join(temporaryDirectory, "index.json");

  try {
    await buildLocalTfidfIndex(resolve("sops"), indexPath);
    const keywordResults = await new MarkdownSopSource(resolve("sops")).search(
      "磁盘使用率过高",
      3,
    );
    const vectorResults = await new LocalTfidfSopSource(indexPath).search(
      "根分区空间不足，需要检查大文件",
      3,
    );

    assert.ok(keywordResults.length <= 3);
    assert.equal(keywordResults[0]?.id, "SOP-DISK-USAGE-HIGH");
    assert.ok(vectorResults.length <= 3);
    assert.equal(vectorResults[0]?.id, "SOP-DISK-USAGE-HIGH");
    assert.equal(vectorResults[0]?.sourcePath, "disk-usage-high.md");
    assert.ok(vectorResults[0]?.keywords.includes("根分区"));
    assert.ok((vectorResults[0]?.steps.length ?? 0) > 0);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("相同 SOP 语料可重复构建完全一致的本地索引", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oncall-rag-repeat-"));
  const firstPath = join(temporaryDirectory, "first.json");
  const secondPath = join(temporaryDirectory, "second.json");

  try {
    await buildLocalTfidfIndex(resolve("sops"), firstPath);
    await buildLocalTfidfIndex(resolve("sops"), secondPath);
    assert.equal(await readFile(firstPath, "utf8"), await readFile(secondPath, "utf8"));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("Embedding 索引通过 Embedder 生成向量并使用本地余弦检索", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oncall-embedding-test-"));
  const indexPath = join(temporaryDirectory, "embedding.json");
  const embedder = new DeterministicTestEmbedder();

  try {
    const index = await buildLocalEmbeddingIndex(resolve("sops"), indexPath, embedder);
    const results = await new LocalEmbeddingSopSource(indexPath, embedder, 0.5).search(
      "根分区空间不足",
      3,
    );

    assert.equal(index.modelId, embedder.modelId);
    assert.equal(index.dimensions, 3);
    assert.equal(results[0]?.id, "SOP-DISK-USAGE-HIGH");
    assert.equal(results[0]?.sourcePath, "disk-usage-high.md");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
