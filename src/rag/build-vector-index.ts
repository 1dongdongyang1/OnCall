import { resolve } from "node:path";
import { buildLocalVectorIndex } from "./local-vector-index.js";

const sopDirectory = resolve("sops");
const indexPath = resolve(".rag-index", "sop-vector-index.json");
const index = await buildLocalVectorIndex(sopDirectory, indexPath);

process.stdout.write(
  `Built vector index: ${indexPath}\n` +
    `Documents: ${index.documents.length}\n` +
    `Corpus SHA-256: ${index.corpusHash}\n`,
);
