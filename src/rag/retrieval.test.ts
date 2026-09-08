import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { MarkdownSopSource } from "../data-sources/markdown-sop-source.js";
import { buildLocalVectorIndex, LocalVectorSopSource } from "./local-vector-index.js";

test("关键词与向量检索都遵守 Top-K 接口并保留 SOP 元数据", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oncall-rag-test-"));
  const indexPath = join(temporaryDirectory, "index.json");

  try {
    await buildLocalVectorIndex(resolve("sops"), indexPath);
    const keywordResults = await new MarkdownSopSource(resolve("sops")).search(
      "磁盘使用率过高",
      3,
    );
    const vectorResults = await new LocalVectorSopSource(indexPath).search(
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
    await buildLocalVectorIndex(resolve("sops"), firstPath);
    await buildLocalVectorIndex(resolve("sops"), secondPath);
    assert.equal(await readFile(firstPath, "utf8"), await readFile(secondPath, "utf8"));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
