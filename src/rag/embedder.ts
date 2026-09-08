import { pipeline } from "@huggingface/transformers";

export interface Embedder {
  readonly modelId: string;
  readonly modelRevision: string;
  embed(texts: string[]): Promise<number[][]>;
}

export const DEFAULT_EMBEDDING_MODEL =
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const DEFAULT_EMBEDDING_MODEL_REVISION =
  "2c4055b12046f11709e9df2c122e59ffbdc2f900";

export class HuggingFaceEmbedder implements Embedder {
  private extractorPromise:
    | ReturnType<typeof pipeline<"feature-extraction">>
    | undefined;

  constructor(
    readonly modelId = DEFAULT_EMBEDDING_MODEL,
    readonly modelRevision = DEFAULT_EMBEDDING_MODEL_REVISION,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) {
      return [];
    }

    this.extractorPromise ??= pipeline("feature-extraction", this.modelId, {
      revision: this.modelRevision,
      dtype: "q8",
    });
    const extractor = await this.extractorPromise;
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const vectors = output.tolist() as number[][];

    if (
      vectors.length !== texts.length ||
      vectors.some(
        (vector) =>
          !Array.isArray(vector) ||
          vector.length === 0 ||
          vector.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new Error("Embedding 模型返回了无效向量");
    }

    return vectors;
  }
}
