import { resolve } from "node:path";
import { buildLocalTfidfIndex } from "./local-tfidf-index.js";

const sopDirectory = resolve("sops");
const indexPath = resolve(".rag-index", "sop-tfidf-index.json");
const index = await buildLocalTfidfIndex(sopDirectory, indexPath);

process.stdout.write(
  `Built TF-IDF index: ${indexPath}\n` +
    `Documents: ${index.documents.length}\n` +
    `Corpus SHA-256: ${index.corpusHash}\n`,
);
