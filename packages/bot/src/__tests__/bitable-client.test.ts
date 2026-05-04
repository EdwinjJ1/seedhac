import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LarkBitableClient, type BitableConfig } from '../bitable-client.js';

// ---------- hoisted mocks (must be above vi.mock factory) ----------

const { mockCreate, mockBatchCreate, mockList, mockUpdate, mockDelete } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockBatchCreate: vi.fn(),
  mockList: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: class {
    bitable = {
      appTableRecord: {
        create: mockCreate,
        batchCreate: mockBatchCreate,
        list: mockList,
        update: mockUpdate,
        delete: mockDelete,
      },
    };
  },
}));

// ---------- fixtures ----------

const CONFIG: BitableConfig = {
  appId: 'app_id',
  appSecret: 'app_secret',
  appToken: 'app_token',
  tableIds: {
    memory: 'tbl_memory',
    decision: 'tbl_decision',
    todo: 'tbl_todo',
    knowledge: 'tbl_knowledge',
  },
};

function makeClient(): LarkBitableClient {
  return new LarkBitableClient(CONFIG);
}

// ---------- tests ----------

describe('LarkBitableClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. insert — happy path
  it('insert returns RecordRef on success', async () => {
    mockCreate.mockResolvedValueOnce({
      data: { record: { record_id: 'rec_001' } },
    });

    const result = await makeClient().insert({ table: 'memory', row: { title: 'test' } });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.recordId).toBe('rec_001');
      expect(result.value.tableId).toBe('tbl_memory');
    }
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  // 2. insert — API returns no record_id
  it('insert returns err when record_id is missing', async () => {
    mockCreate.mockResolvedValueOnce({ data: { record: {} } });

    const result = await makeClient().insert({ table: 'memory', row: {} });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FEISHU_API_ERROR');
    }
  });

  // 3. find — happy path with pagination fields
  it('find returns records with hasMore and nextPageToken', async () => {
    mockList.mockResolvedValueOnce({
      data: {
        items: [{ record_id: 'rec_a', fields: { title: 'hello' } }],
        has_more: true,
        page_token: 'tok_next',
      },
    });

    const result = await makeClient().find({ table: 'decision', pageSize: 10 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.records).toHaveLength(1);
      expect(result.value.records[0]!.recordId).toBe('rec_a');
      expect(result.value.hasMore).toBe(true);
      expect(result.value.nextPageToken).toBe('tok_next');
    }
  });

  it('find converts where into a Bitable filter expression', async () => {
    mockList.mockResolvedValueOnce({
      data: {
        items: [],
        has_more: false,
      },
    });

    const result = await makeClient().find({
      table: 'memory',
      where: { chatId: 'chat_1', source: 'slides' },
      pageSize: 3,
    });

    expect(result.ok).toBe(true);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          page_size: 3,
          filter: 'AND(CurrentValue.[chatId]="chat_1",CurrentValue.[source]="slides")',
        }),
      }),
    );
  });

  it('find prefers explicit filter over where', async () => {
    mockList.mockResolvedValueOnce({
      data: {
        items: [],
        has_more: false,
      },
    });

    const result = await makeClient().find({
      table: 'memory',
      where: { chatId: 'chat_1' },
      filter: 'CurrentValue.[chat_id]="oc_real"',
    });

    expect(result.ok).toBe(true);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          filter: 'CurrentValue.[chat_id]="oc_real"',
        }),
      }),
    );
  });

  // 4. batchInsert — splits into chunks of batchSize
  it('batchInsert calls batchCreate twice when rows exceed batchSize', async () => {
    const chunk1Records = Array.from({ length: 3 }, (_, i) => ({ record_id: `rec_${i}` }));
    const chunk2Records = Array.from({ length: 2 }, (_, i) => ({ record_id: `rec_${i + 3}` }));

    mockBatchCreate
      .mockResolvedValueOnce({ data: { records: chunk1Records } })
      .mockResolvedValueOnce({ data: { records: chunk2Records } });

    const rows = Array.from({ length: 5 }, (_, i) => ({ idx: i }));
    const result = await makeClient().batchInsert({ table: 'todo', rows, batchSize: 3 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(5);
    }
    expect(mockBatchCreate).toHaveBeenCalledTimes(2);
  });

  // 5. update — happy path
  it('update returns ok(undefined) on success', async () => {
    mockUpdate.mockResolvedValueOnce({});

    const result = await makeClient().update({
      table: 'todo',
      recordId: 'rec_x',
      patch: { status: 'done' },
    });

    expect(result.ok).toBe(true);
  });

  // 6. delete — happy path
  it('delete returns ok(undefined) on success', async () => {
    mockDelete.mockResolvedValueOnce({});

    const result = await makeClient().delete({ table: 'knowledge', recordId: 'rec_y' });

    expect(result.ok).toBe(true);
    expect(mockDelete).toHaveBeenCalledOnce();
  });

  // 7. retry — retries up to 3 times on network error, then returns err
  it('retries 3 times and returns err after all attempts fail', async () => {
    mockCreate.mockRejectedValue(new Error('network error'));

    const result = await makeClient().insert({ table: 'memory', row: {} });

    expect(result.ok).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  }, 15_000);

  // 8. retry — succeeds on second attempt
  it('retries and succeeds on second attempt', async () => {
    mockCreate
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ data: { record: { record_id: 'rec_retry' } } });

    const result = await makeClient().insert({ table: 'memory', row: {} });

    expect(result.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  }, 5_000);

  // 9. link — sends correct field structure
  it('link calls update with record_id array in field', async () => {
    mockUpdate.mockResolvedValueOnce({});

    const result = await makeClient().link({
      fromTable: 'knowledge',
      fromRecordId: 'rec_from',
      fieldName: 'related',
      toTable: 'memory',
      toRecordIds: ['rec_1', 'rec_2'],
    });

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          fields: {
            related: [{ record_id: 'rec_1' }, { record_id: 'rec_2' }],
          },
        },
      }),
    );
  });
});
