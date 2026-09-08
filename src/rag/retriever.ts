export interface RetrievedDocument {
  id: string;
  content: string;
  score: number;
}

/** Contract reserved for the future SOP retrieval implementation. */
export interface Retriever {
  search(query: string, limit?: number): Promise<RetrievedDocument[]>;
}
