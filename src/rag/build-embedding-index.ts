import { resolve } from "node:path";
import { buildChunkStore } from "./chunk-store.js";
import { HuggingFaceEmbedder } from "./embedder.js";
import { buildLocalEmbeddingIndex } from "./local-embedding-index.js";

const sopDirectory = resolve("sops");
const chunkStorePath = resolve(".rag-index", "sop-chunks.json");
const indexPath = resolve(".rag-index", "sop-embedding-index.json");
const embedder = new HuggingFaceEmbedder();
const store = await buildChunkStore(sopDirectory, chunkStorePath);
const index = await buildLocalEmbeddingIndex(chunkStorePath, indexPath, embedder);

process.stdout.write(
  `Built Embedding index: ${indexPath}\n` +
    `Model: ${index.modelId}@${index.modelRevision}\n` +
    `Dimensions: ${index.dimensions}\n` +
    `Documents: ${store.documents.length}\n` +
    `Chunks: ${index.chunks.length}\n` +
    `Chunk store SHA-256: ${index.chunkStoreHash}\n`,
);
