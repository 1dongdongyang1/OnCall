/** Contract reserved for the future SOP embedding implementation. */
export interface Embedder {
  embed(text: string): Promise<number[]>;
}
