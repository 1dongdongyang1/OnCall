export interface RetrievedDocument<TMetadata = Record<string, unknown>> {
  id: string;
  content: string;
  score: number;
  metadata: TMetadata;
}

export interface Retriever {
  search(query: string, limit?: number): Promise<RetrievedDocument[]>;
}
