import type { SopChunk } from "./chunk-store.js";
import { loadChunkStore } from "./chunk-store.js";

function stripVector(chunk: SopChunk & { vector?: number[] }): SopChunk {
  const { vector: _vector, ...metadata } = chunk;
  return metadata;
}

export async function assertIndexMatchesChunkStore(
  kind: string,
  chunkStorePath: string,
  chunkStoreHash: string,
  indexedChunks: Array<SopChunk & { vector?: number[] }>,
): Promise<void> {
  const store = await loadChunkStore(chunkStorePath);
  if (chunkStoreHash !== store.corpusHash) {
    throw new Error(`${kind} 索引已过期：ChunkStore hash 不一致，请重建索引`);
  }
  const indexMetadata = indexedChunks.map(stripVector);
  if (JSON.stringify(indexMetadata) !== JSON.stringify(store.chunks)) {
    throw new Error(`${kind} 索引元数据与 ChunkStore 不一致，请重建索引`);
  }
}
