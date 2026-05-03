/**
 * VectorRetriever — 实现 Retriever 接口，Chroma 语义召回 + LLM 精排。
 *
 * source = 'vector'
 * chatId 为空时做全局搜索
 */

import {
  type Retriever,
  type RetrieverSource,
  type RetrieveQuery,
  type RetrieveHit,
  type Result,
  type LLMClient,
  ok,
  err,
} from '@seedhac/contracts';
import { type ChromaClient, type SearchHit } from './chroma-client.js';
import { type EmbeddingClient } from './embedding-client.js';

const CHROMA_CANDIDATE_SIZE = 50;

export class VectorRetriever implements Retriever {
  readonly source: RetrieverSource = 'vector';

  constructor(
    private readonly chroma: ChromaClient,
    private readonly embedding: EmbeddingClient,
    private readonly llm: LLMClient,
  ) {}

  async retrieve(query: RetrieveQuery): Promise<Result<readonly RetrieveHit[]>> {
    const vecResult = await this.embedding.embed(query.query);
    if (!vecResult.ok) return err(vecResult.error);

    const searchResult = await this.chroma.search(
      query.chatId ?? '',
      vecResult.value,
      CHROMA_CANDIDATE_SIZE,
    );
    if (!searchResult.ok) return err(searchResult.error);

    const hits = searchResult.value;
    if (hits.length === 0) return ok([]);

    const topK = query.topK ?? 3;
    const reranked = await this.rerank(query.query, hits, topK);
    return ok(reranked);
  }

  private async rerank(query: string, hits: SearchHit[], topK: number): Promise<readonly RetrieveHit[]> {
    const list = hits
      .map((h, i) => `[${i + 1}] id=${h.messageId}\n${h.content}`)
      .join('\n\n');

    const prompt = `你是一个消息相关性排序助手。

用户的查询是："${query}"

下面是候选消息列表：
${list}

请从中选出最相关的消息，按相关性从高到低排序，只返回 JSON 数组格式的 messageId 列表，不要包含任何其他文字。
例如：["msg_3","msg_1"]
如果没有相关消息，返回空数组：[]`;

    const llmResult = await this.llm.ask(prompt, { model: 'lite' });

    let orderedIds: string[] = [];
    if (llmResult.ok) {
      try {
        const cleaned = llmResult.value.trim().replace(/```json|```/g, '').trim();
        orderedIds = JSON.parse(cleaned) as string[];
      } catch {
        // fallback below
      }
    }

    const hitMap = new Map(hits.map((h) => [h.messageId, h]));

    if (orderedIds.length > 0) {
      return orderedIds.slice(0, topK).flatMap((id) => {
        const h = hitMap.get(id);
        return h ? [this.toRetrieveHit(h)] : [];
      });
    }

    return hits.slice(0, topK).map((h) => this.toRetrieveHit(h));
  }

  private toRetrieveHit(h: SearchHit): RetrieveHit {
    return {
      source: 'vector',
      id: h.messageId,
      title: h.content.slice(0, 30),
      snippet: h.content.slice(0, 200),
      score: Math.max(0, 1 - h.distance),
      timestamp: h.timestamp,
      meta: { chatId: h.chatId },
    };
  }
}
