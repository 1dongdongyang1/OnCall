export type Sop = {
  id: string;
  title: string;
  steps: string[];
};

export interface SopSource {
  findByQuery(query: string): Promise<Sop | null>;
}
