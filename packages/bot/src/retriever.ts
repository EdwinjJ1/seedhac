/**
 * Retriever 实现 — 整合 Chroma 语义召回 + LLM 精排 + Bitable 时序查询。
 *
 * 约束（issue #20）：
 *   - search: Chroma top 50 → LLM rerank → top limit（默认 3）
 *   - recent: Bitable 按 timestamp 倒序取 n 条
 *   - 两种方法均 5 秒内返回
 */

import type { LLMClient, BitableClient } from '@seedhac/contracts';
import { type ChromaClient } from './chroma-client.js';
import { type EmbeddingClient } from './embedding-client.js';
import { buildRerankPrompt, type RerankCandidate } from './rerank-prompt.js';

export interface RetrievedMessage {
  readonly messageId: string;
  readonly chatId: string;
  readonly userId: string;
  readonly content: string;
  readonly timestamp: number;
  readonly score?: number;
}

export class MessageRetriever {
  constructor(
    private readonly chroma: ChromaClient,
    private readonly embedding: EmbeddingClient,
    private readonly llm: LLMClient,
    private readonly bitable: BitableClient,
  ) {}

  /**
   * 语义召回 + LLM 精排。
   * Chroma 召回 top 50 → LLM 按相关性重排 → 返回 top limit 条。
   */
  async search(chatId: string, query: string, limit = 3): Promise<RetrievedMessage[]> {
    const queryEmbedding = await this.embedding.text(query);
    const hits = await this.chroma.search(chatId, queryEmbedding, 50);

    if (hits.length === 0) return [];

    const candidates: RerankCandidate[] = hits.map((h) => ({
      messageId: h.messageId,
      content: h.content,
      timestamp: h.timestamp,
    }));

    const reranked = await this.rerank(query, candidates, limit);
    return reranked;
  }

  /**
   * 时序查询 — Bitable 按 timestamp 倒序取最近 n 条。
   */
  async recent(chatId: string, n: number): Promise<RetrievedMessage[]> {
    const result = await this.bitable.find({
      table: 'memory',
      filter: `AND(CurrentValue.[chatId]="${chatId}")`,
      pageSize: n,
    });

    if (!result.ok) return [];

    return result.value.records.map((r) => ({
      messageId: String(r['messageId'] ?? r['recordId']),
      chatId: String(r['chatId'] ?? chatId),
      userId: String(r['userId'] ?? ''),
      content: String(r['content'] ?? ''),
      timestamp: Number(r['timestamp'] ?? 0),
    }));
  }

  private async rerank(
    query: string,
    candidates: RerankCandidate[],
    limit: number,
  ): Promise<RetrievedMessage[]> {
    const prompt = buildRerankPrompt(query, candidates);
    const result = await this.llm.ask(prompt, { model: 'lite' });

    if (!result.ok) {
      // LLM 精排失败时，退化为按 Chroma 距离排序
      return candidates.slice(0, limit).map((c) => ({
        messageId: c.messageId,
        chatId: '',
        userId: '',
        content: c.content,
        timestamp: c.timestamp,
      }));
    }

    let ids: string[] = [];
    try {
      const cleaned = result.value.trim().replace(/```json|```/g, '').trim();
      ids = JSON.parse(cleaned) as string[];
    } catch {
      return candidates.slice(0, limit).map((c) => ({
        messageId: c.messageId,
        chatId: '',
        userId: '',
        content: c.content,
        timestamp: c.timestamp,
      }));
    }

    const candidateMap = new Map(candidates.map((c) => [c.messageId, c]));
    return ids
      .slice(0, limit)
      .map((id) => {
        const c = candidateMap.get(id);
        return c
          ? { messageId: c.messageId, chatId: '', userId: '', content: c.content, timestamp: c.timestamp }
          : null;
      })
      .filter((x): x is RetrievedMessage => x !== null);
  }
}
