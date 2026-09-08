export type Sop = {
  id: string;
  title: string;
  keywords: string[];
  steps: string[];
  sourcePath: string;
};

export type SopSearchResult = Sop & { score: number };

export interface SopSource {
  search(query: string, limit?: number): Promise<SopSearchResult[]>;
}
