export type SopSearchResult = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourcePath: string;
  headingPath: string[];
  content: string;
  contentHash: string;
  score: number;
};

export interface SopSource {
  search(query: string, limit?: number): Promise<SopSearchResult[]>;
}
