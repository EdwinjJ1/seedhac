import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BitableRetriever } from '../bitable-retriever.js';

const mockBitableFind = vi.fn();
const mockBitable = { find: mockBitableFind, insert: vi.fn(), batchInsert: vi.fn(), update: vi.fn(), delete: vi.fn(), link: vi.fn() };

function makeRetriever(): BitableRetriever {
  return new BitableRetriever(mockBitable as never);
}

describe('BitableRetriever', () => {
  beforeEach(() => vi.clearAllMocks());

  it('source is bitable', () => {
    expect(makeRetriever().source).toBe('bitable');
  });

  it('retrieve returns mapped RetrieveHit array', async () => {
    mockBitableFind.mockResolvedValueOnce({
      ok: true,
      value: {
        records: [
          { recordId: 'rec_1', messageId: 'msg_1', chatId: 'chat_a', userId: 'u1', content: 'hello world', timestamp: 5000 },
          { recordId: 'rec_2', messageId: 'msg_2', chatId: 'chat_a', userId: 'u2', content: 'goodbye', timestamp: 4000 },
        ],
        hasMore: false,
      },
    });

    const result = await makeRetriever().retrieve({ query: '', chatId: 'chat_a', topK: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]!.id).toBe('msg_1');
      expect(result.value[0]!.source).toBe('bitable');
      expect(result.value[0]!.snippet).toBe('hello world');
    }
  });

  it('retrieve returns empty array when Bitable returns err', async () => {
    mockBitableFind.mockResolvedValueOnce({ ok: false, error: { code: 'FEISHU_API_ERROR', message: 'fail' } });

    const result = await makeRetriever().retrieve({ query: '', chatId: 'chat_a' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('retrieve passes chatId filter to Bitable', async () => {
    mockBitableFind.mockResolvedValueOnce({ ok: true, value: { records: [], hasMore: false } });

    await makeRetriever().retrieve({ query: '', chatId: 'chat_x', topK: 5 });

    expect(mockBitableFind).toHaveBeenCalledWith(
      expect.objectContaining({ filter: expect.stringContaining('chat_x') }),
    );
  });
});
