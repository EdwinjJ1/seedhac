import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorRetriever } from '../vector-retriever.js';

const mockChromaSearch = vi.fn();
const mockEmbeddingEmbed = vi.fn();
const mockLLMAsk = vi.fn();

const mockChroma = { search: mockChromaSearch };
const mockEmbedding = { embed: mockEmbeddingEmbed };
const mockLLM = { ask: mockLLMAsk, chat: vi.fn(), askStructured: vi.fn() };

function makeRetriever(): VectorRetriever {
  return new VectorRetriever(mockChroma as never, mockEmbedding as never, mockLLM as never);
}

function makeHit(i: number) {
  return { messageId: `msg_${i}`, chatId: 'chat_a', userId: `u${i}`, content: `content ${i}`, timestamp: i * 1000, distance: i * 0.01 };
}

describe('VectorRetriever', () => {
  beforeEach(() => vi.clearAllMocks());

  it('source is vector', () => {
    expect(makeRetriever().source).toBe('vector');
  });

  it('retrieve returns LLM-reranked RetrieveHit array', async () => {
    mockEmbeddingEmbed.mockResolvedValueOnce({ ok: true, value: [0.1, 0.2] });
    mockChromaSearch.mockResolvedValueOnce([makeHit(1), makeHit(2), makeHit(3)]);
    mockLLMAsk.mockResolvedValueOnce({ ok: true, value: '["msg_3","msg_1"]' });

    const result = await makeRetriever().retrieve({ query: 'test', chatId: 'chat_a', topK: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]!.id).toBe('msg_3');
      expect(result.value[0]!.source).toBe('vector');
    }
  });

  it('retrieve returns err when embedding fails', async () => {
    mockEmbeddingEmbed.mockResolvedValueOnce({ ok: false, error: { code: 'FEISHU_API_ERROR', message: 'fail' } });

    const result = await makeRetriever().retrieve({ query: 'test' });

    expect(result.ok).toBe(false);
    expect(mockChromaSearch).not.toHaveBeenCalled();
  });

  it('retrieve returns empty when Chroma has no hits', async () => {
    mockEmbeddingEmbed.mockResolvedValueOnce({ ok: true, value: [0.1] });
    mockChromaSearch.mockResolvedValueOnce([]);

    const result = await makeRetriever().retrieve({ query: 'test', chatId: 'chat_a' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    expect(mockLLMAsk).not.toHaveBeenCalled();
  });

  it('retrieve falls back to Chroma order when LLM fails', async () => {
    mockEmbeddingEmbed.mockResolvedValueOnce({ ok: true, value: [0.1] });
    mockChromaSearch.mockResolvedValueOnce([makeHit(1), makeHit(2)]);
    mockLLMAsk.mockResolvedValueOnce({ ok: false, error: { code: 'LLM_TIMEOUT', message: 'timeout' } });

    const result = await makeRetriever().retrieve({ query: 'test', chatId: 'chat_a', topK: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]!.id).toBe('msg_1');
    }
  });

  it('retrieve falls back when LLM returns invalid JSON', async () => {
    mockEmbeddingEmbed.mockResolvedValueOnce({ ok: true, value: [0.1] });
    mockChromaSearch.mockResolvedValueOnce([makeHit(1), makeHit(2)]);
    mockLLMAsk.mockResolvedValueOnce({ ok: true, value: 'not json' });

    const result = await makeRetriever().retrieve({ query: 'test', chatId: 'chat_a', topK: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
  });

  it('retrieve handles LLM response with markdown code fence', async () => {
    mockEmbeddingEmbed.mockResolvedValueOnce({ ok: true, value: [0.1] });
    mockChromaSearch.mockResolvedValueOnce([makeHit(1), makeHit(2)]);
    mockLLMAsk.mockResolvedValueOnce({ ok: true, value: '```json\n["msg_2","msg_1"]\n```' });

    const result = await makeRetriever().retrieve({ query: 'test', chatId: 'chat_a', topK: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]!.id).toBe('msg_2');
  });
});
