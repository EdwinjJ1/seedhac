/**
 * EmbeddingClient — 豆包 embedding 调用封装。
 *
 * 约束（issue #17）：
 *   - embed.text(content) 返回 number[]
 *   - 失败重试 2 次后抛错（不静默吞）
 */

const ARK_EMBEDDING_URL = 'https://ark.cn-beijing.volces.com/api/v3/embeddings';
const RETRY_DELAYS_MS = [1000, 2000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface EmbeddingConfig {
  readonly apiKey: string;
  readonly model: string; // ep- 接入点 ID
}

export class EmbeddingClient {
  constructor(private readonly config: EmbeddingConfig) {}

  async text(content: string): Promise<number[]> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const resp = await fetch(ARK_EMBEDDING_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({ model: this.config.model, input: content }),
        });

        if (!resp.ok) {
          throw new Error(`embedding API ${resp.status}: ${await resp.text()}`);
        }

        const data = (await resp.json()) as { data: Array<{ embedding: number[] }> };
        const embedding = data.data[0]?.embedding;
        if (!embedding) throw new Error('embedding API: empty response');
        return embedding;
      } catch (e) {
        lastErr = e;
        if (attempt < 2) await sleep(RETRY_DELAYS_MS[attempt as 0 | 1]);
      }
    }
    throw lastErr;
  }
}

export function createEmbeddingClient(): EmbeddingClient {
  const apiKey = process.env['ARK_API_KEY'];
  const model = process.env['ARK_EMBEDDING_EP'];
  if (!apiKey) throw new Error('Missing env var: ARK_API_KEY');
  if (!model) throw new Error('Missing env var: ARK_EMBEDDING_EP');
  return new EmbeddingClient({ apiKey, model });
}
