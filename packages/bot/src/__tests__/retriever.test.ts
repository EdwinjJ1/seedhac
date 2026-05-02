import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageRetriever } from '../retriever.js';

// ---------- mocks ----------

const mockChromaSearch = vi.fn();
const mockEmbeddingText = vi.fn();
const mockLLMAsk = vi.fn();
const mockBitableFind = vi.fn();

const mockChroma = { search: mockChromaSearch };
const mockEmbedding = { text: mockEmbeddingText };
const mockLLM = { ask: mockLLMAsk, chat: vi.fn(), askStructured: vi.fn() };
const mockBitable = { find: mockBitableFind, insert: vi.fn(), batchInsert: vi.fn(), update: vi.fn(), delete: vi.fn(), link: vi.fn() };

function makeRetriever(): MessageRetriever {
  return new MessageRetriever(
    mockChroma as never,
    mockEmbedding as never,
    mockLLM as never,
    mockBitable as never,
  );
}

function makeHit(i: number) {
  return {
    messageId: `msg_${i}`,
    chatId: 'chat_a',
    userId: `user_${i}`,
    content: `content ${i}`,
    timestamp: i * 1000,
    distance: i * 0.01,
  };
}

// ---------- tests ----------

describe('MessageRetriever', () => {
  beforeEach(() => vi.clearAllMocks());

  // 1. search — happy path with LLM rerank
  it('search returns LLM-reranked results up to limit', async () => {
    mockEmbeddingText.mockResolvedValueOnce([0.1, 0.2]);
    mockChromaSearch.mockResolvedValueOnce([makeHit(1), makeHit(2), makeHit(3)]);
    mockLLMAsk.mockResolvedValueOnce({ ok: true, value: '["msg_3","msg_1"]' });

    const results = await makeRetriever().search('chat_a', 'test query', 2);

    expect(results).toHaveLength(2);
    expect(results[0]!.messageId).toBe('msg_3');
    expect(results[1]!.messageId).toBe('msg_1');
  });

  // 2. search — falls back to Chroma order when LLM fails
  it('search falls back to Chroma order when LLM returns err', async () => {
    mockEmbeddingText.mockResolvedValueOnce([0.1]);
    mockChromaSearch.mockResolvedValueOnce([makeHit(1), makeHit(2), makeHit(3)]);
    mockLLMAsk.mockResolvedValueOnce({ ok: false, error: { code: 'LLM_TIMEOUT', message: 'timeout' } });

    const results = await makeRetriever().search('chat_a', 'query', 2);

    expect(results).toHaveLength(2);
    expect(results[0]!.messageId).toBe('msg_1');
  });

  // 3. search — falls back when LLM returns invalid JSON
  it('search falls back to Chroma order when LLM returns invalid JSON', async () => {
    mockEmbeddingText.mockResolvedValueOnce([0.1]);
    mockChromaSearch.mockResolvedValueOnce([makeHit(1), makeHit(2)]);
    mockLLMAsk.mockResolvedValueOnce({ ok: true, value: 'not valid json' });

    const results = await makeRetriever().search('chat_a', 'query', 2);

    expect(results).toHaveLength(2);
  });

  // 4. search — returns empty when Chroma has no hits
  it('search returns empty array when no Chroma hits', async () => {
    mockEmbeddingText.mockResolvedValueOnce([0.1]);
    mockChromaSearch.mockResolvedValueOnce([]);

    const results = await makeRetriever().search('chat_a', 'query');

    expect(results).toHaveLength(0);
    expect(mockLLMAsk).not.toHaveBeenCalled();
  });

  // 5. recent — maps Bitable records correctly
  it('recent returns mapped records from Bitable', async () => {
    mockBitableFind.mockResolvedValueOnce({
      ok: true,
      value: {
        records: [
          { recordId: 'rec_1', messageId: 'msg_1', chatId: 'chat_a', userId: 'u1', content: 'hello', timestamp: 5000 },
          { recordId: 'rec_2', messageId: 'msg_2', chatId: 'chat_a', userId: 'u2', content: 'world', timestamp: 4000 },
        ],
        hasMore: false,
      },
    });

    const results = await makeRetriever().recent('chat_a', 2);

    expect(results).toHaveLength(2);
    expect(results[0]!.messageId).toBe('msg_1');
    expect(results[0]!.content).toBe('hello');
  });

  // 6. recent — returns empty when Bitable returns err
  it('recent returns empty array when Bitable returns err', async () => {
    mockBitableFind.mockResolvedValueOnce({ ok: false, error: { code: 'FEISHU_API_ERROR', message: 'fail' } });

    const results = await makeRetriever().recent('chat_a', 5);

    expect(results).toHaveLength(0);
  });

  // 7. search — LLM rerank with markdown code fence in response
  it('search handles LLM response wrapped in markdown code fence', async () => {
    mockEmbeddingText.mockResolvedValueOnce([0.1]);
    mockChromaSearch.mockResolvedValueOnce([makeHit(1), makeHit(2)]);
    mockLLMAsk.mockResolvedValueOnce({ ok: true, value: '```json\n["msg_2","msg_1"]\n```' });

    const results = await makeRetriever().search('chat_a', 'query', 2);

    expect(results[0]!.messageId).toBe('msg_2');
  });
});
