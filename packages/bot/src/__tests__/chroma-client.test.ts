import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChromaClient } from '../chroma-client.js';
import { EmbeddingClient } from '../embedding-client.js';

// ---------- mock chromadb ----------

const mockAdd = vi.fn();
const mockQuery = vi.fn();
const mockDeleteCollection = vi.fn();
const mockGetOrCreateCollection = vi.fn();

vi.mock('chromadb', () => ({
  ChromaClient: class {
    getOrCreateCollection = mockGetOrCreateCollection;
    deleteCollection = mockDeleteCollection;
  },
}));

// ---------- mock fetch (embedding) ----------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------- helpers ----------

function makeEmbedding(seed: number, dim = 8): number[] {
  return Array.from({ length: dim }, (_, i) => Math.sin(seed + i));
}

function setupCollectionMock(): void {
  mockGetOrCreateCollection.mockResolvedValue({
    add: mockAdd,
    query: mockQuery,
  });
}

// ---------- ChromaClient tests ----------

describe('ChromaClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCollectionMock();
  });

  it('insert calls collection.add with correct shape', async () => {
    mockAdd.mockResolvedValueOnce(undefined);

    const client = new ChromaClient();
    await client.insert({
      messageId: 'msg_1',
      chatId: 'chat_a',
      userId: 'user_x',
      content: 'hello world',
      timestamp: 1000,
      embedding: makeEmbedding(1),
    });

    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        ids: ['msg_1'],
        metadatas: [expect.objectContaining({ chatId: 'chat_a', userId: 'user_x' })],
      }),
    );
  });

  it('search returns mapped SearchHit array', async () => {
    mockQuery.mockResolvedValueOnce({
      ids: [['msg_1', 'msg_2']],
      distances: [[0.1, 0.3]],
      documents: [['hello', 'world']],
      metadatas: [
        [
          { chatId: 'chat_a', userId: 'u1', messageId: 'msg_1', timestamp: 1000 },
          { chatId: 'chat_a', userId: 'u2', messageId: 'msg_2', timestamp: 2000 },
        ],
      ],
    });

    const client = new ChromaClient();
    const hits = await client.search('chat_a', makeEmbedding(0), 2);

    expect(hits).toHaveLength(2);
    expect(hits[0]!.messageId).toBe('msg_1');
    expect(hits[0]!.distance).toBe(0.1);
    expect(hits[1]!.content).toBe('world');
  });

  it('search filters by chatId via where clause', async () => {
    mockQuery.mockResolvedValueOnce({ ids: [[]], distances: [[]], documents: [[]], metadatas: [[]] });

    const client = new ChromaClient();
    await client.search('chat_b', makeEmbedding(0), 5);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chatId: 'chat_b' } }),
    );
  });

  it('search returns empty array when no results', async () => {
    mockQuery.mockResolvedValueOnce({ ids: [[]], distances: [[]], documents: [[]], metadatas: [[]] });

    const client = new ChromaClient();
    const hits = await client.search('chat_z', makeEmbedding(0), 5);

    expect(hits).toHaveLength(0);
  });

  it('deleteCollection resets internal collection cache', async () => {
    mockDeleteCollection.mockResolvedValueOnce(undefined);
    mockAdd.mockResolvedValue(undefined);

    const client = new ChromaClient();
    // First insert to populate cache
    await client.insert({ messageId: 'm1', chatId: 'c', userId: 'u', content: 'x', timestamp: 0, embedding: makeEmbedding(0) });
    await client.deleteCollection();

    // After delete, next call should re-create collection
    await client.insert({ messageId: 'm2', chatId: 'c', userId: 'u', content: 'y', timestamp: 1, embedding: makeEmbedding(1) });
    expect(mockGetOrCreateCollection).toHaveBeenCalledTimes(2);
  });
});

// ---------- EmbeddingClient tests ----------

describe('EmbeddingClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('embed() returns ok with embedding array from API', async () => {
    const embedding = makeEmbedding(0, 1536);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding }] }),
    });

    const client = new EmbeddingClient({ apiKey: 'test-key', model: 'ep-test' });
    const result = await client.embed('hello');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1536);
      expect(result.value[0]).toBeCloseTo(embedding[0]!);
    }
  });

  it('embed() retries on failure and returns ok on second attempt', async () => {
    const embedding = makeEmbedding(1, 8);
    mockFetch
      .mockResolvedValueOnce({ ok: false, text: async () => 'server error' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding }] }) });

    const client = new EmbeddingClient({ apiKey: 'key', model: 'ep-test' });
    const result = await client.embed('retry test');

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  }, 5_000);

  it('embed() returns err after 3 failed attempts', async () => {
    mockFetch.mockResolvedValue({ ok: false, text: async () => 'error' });

    const client = new EmbeddingClient({ apiKey: 'key', model: 'ep-test' });
    const result = await client.embed('fail');

    expect(result.ok).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 10_000);
});
