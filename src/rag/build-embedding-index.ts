import { resolve } from "node:path";
import { HuggingFaceEmbedder } from "./embedder.js";
import { buildLocalEmbeddingIndex } from "./local-embedding-index.js";

const sopDirectory = resolve("sops");
const indexPath = resolve(".rag-index", "sop-embedding-index.json");
const embedder = new HuggingFaceEmbedder();
const index = await buildLocalEmbeddingIndex(sopDirectory, indexPath, embedder);

process.stdout.write(
  `Built Embedding index: ${indexPath}\n` +
    `Model: ${index.modelId}@${index.modelRevision}\n` +
    `Dimensions: ${index.dimensions}\n` +
    `Documents: ${index.documents.length}\n` +
    `Corpus SHA-256: ${index.corpusHash}\n`,
);
