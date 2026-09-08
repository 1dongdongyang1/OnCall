import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildChunkStore,
  diffChunkStores,
  loadChunkStore,
} from "./chunk-store.js";
import { buildLocalKeywordIndex } from "./local-keyword-index.js";
import { buildLocalTfidfIndex } from "./local-tfidf-index.js";

const sopDirectory = resolve("sops");
const chunkStorePath = resolve(".rag-index", "sop-chunks.json");
const keywordIndexPath = resolve(".rag-index", "sop-keyword-index.json");
const tfidfIndexPath = resolve(".rag-index", "sop-tfidf-index.json");
const previousStore = existsSync(chunkStorePath)
  ? await loadChunkStore(chunkStorePath)
  : undefined;
const store = await buildChunkStore(sopDirectory, chunkStorePath);
await buildLocalKeywordIndex(chunkStorePath, keywordIndexPath);
await buildLocalTfidfIndex(chunkStorePath, tfidfIndexPath);

process.stdout.write(
  `Built chunk store: ${chunkStorePath}\n` +
    `Built keyword index: ${keywordIndexPath}\n` +
    `Built TF-IDF index: ${tfidfIndexPath}\n` +
    `Documents: ${store.documents.length}\n` +
    `Chunks: ${store.chunks.length}\n` +
    `Corpus SHA-256: ${store.corpusHash}\n`,
);

if (previousStore) {
  const diff = diffChunkStores(previousStore, store);
  process.stdout.write(
    `Chunk changes: added=${diff.addedChunkIds.length}, ` +
      `removed=${diff.removedChunkIds.length}, ` +
      `unchanged=${diff.unchangedChunkIds.length}, ` +
      `changedLocations=${diff.changedLocations.length}\n`,
  );
}
