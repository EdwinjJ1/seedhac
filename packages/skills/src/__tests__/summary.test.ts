import { describe, it, expect, vi, beforeEach } from 'vitest';
import { summarySkill } from '../summary.js';
import type { SkillContext, BotEvent, Message } from '@seedhac/contracts';

const mockLLMAsk = vi.fn();
const mockFetchHistory = vi.fn();
const mockBitableBatchInsert = vi.fn();
const mockBitableInsert = vi.fn();

function makeMessage(text: string): Message {
  return {
    messageId: 'msg_1',
    chatId: 'chat_1',
    chatType: 'group',
    sender: { userId: 'u1', name: 'Alice' },
    contentType: 'text',
    text,
    rawContent: text,
    mentions: [],
    timestamp: Date.now(),
  };
}

function makeEvent(text: string): BotEvent {
  return { type: 'message', payload: makeMessage(text) };
}

function makeCtx(event: BotEvent): SkillContext {
  return {
    event,
    runtime: { fetchHistory: mockFetchHistory, sendText: vi.fn(), sendCard: vi.fn(), patchCard: vi.fn(), on: vi.fn(), start: vi.fn(), stop: vi.fn() },
    llm: { ask: mockLLMAsk, chat: vi.fn(), askStructured: vi.fn() },
    bitable: { find: vi.fn(), insert: mockBitableInsert, batchInsert: mockBitableBatchInsert, update: vi.fn(), delete: vi.fn(), link: vi.fn() },
    retrievers: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as SkillContext;
}

const VALID_LLM_RESPONSE = JSON.stringify({
  decisions: ['采用方案A', '预算定为 10 万'],
  actionItems: [{ owner: 'Alice', content: '完成前端开发', ddl: '2026-05-10' }],
  issues: ['后端接口未确认'],
  nextSteps: ['下周召开评审会'],
});

describe('summarySkill', () => {
  beforeEach(() => vi.clearAllMocks());

  it('match returns true when message contains 会议纪要', () => {
    expect(summarySkill.match(makeCtx(makeEvent('会议纪要已发，请大家查看')))).toBe(true);
  });

  it('match returns true when message contains 妙记', () => {
    expect(summarySkill.match(makeCtx(makeEvent('妙记链接来了')))).toBe(true);
  });

  it('match returns false for unrelated message', () => {
    expect(summarySkill.match(makeCtx(makeEvent('今天需要完成前端开发')))).toBe(false);
  });

  it('match returns false for non-message event', () => {
    const ctx = makeCtx({ type: 'botJoinedChat', payload: { chatId: 'c', inviter: { userId: 'u' }, timestamp: 0 } });
    expect(summarySkill.match(ctx)).toBe(false);
  });

  it('run normal path: batchInsert called, summary card returned', async () => {
    mockFetchHistory.mockResolvedValueOnce({ ok: true, value: { messages: [makeMessage('会议纪要如下')], hasMore: false } });
    mockLLMAsk.mockResolvedValueOnce({ ok: true, value: VALID_LLM_RESPONSE });
    mockBitableBatchInsert.mockResolvedValue({ ok: true, value: [] });
    mockBitableInsert.mockResolvedValueOnce({ ok: true, value: { tableId: 't', recordId: 'r' } });

    const result = await summarySkill.run(makeCtx(makeEvent('本次会议总结')));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.card?.templateName).toBe('summary');
      expect(result.value.card?.content['decisions']).toEqual(['采用方案A', '预算定为 10 万']);
    }
    expect(mockBitableBatchInsert).toHaveBeenCalledTimes(2); // decision + todo
  });

  it('run: LLM failure returns err, batchInsert not called', async () => {
    mockFetchHistory.mockResolvedValueOnce({ ok: true, value: { messages: [], hasMore: false } });
    mockLLMAsk.mockResolvedValueOnce({ ok: false, error: { code: 'LLM_TIMEOUT', message: 'timeout' } });

    const result = await summarySkill.run(makeCtx(makeEvent('会议总结')));

    expect(result.ok).toBe(false);
    expect(mockBitableBatchInsert).not.toHaveBeenCalled();
  });

  it('run: fetchHistory failure returns err', async () => {
    mockFetchHistory.mockResolvedValueOnce({ ok: false, error: { code: 'FEISHU_API_ERROR', message: 'fail' } });

    const result = await summarySkill.run(makeCtx(makeEvent('会议纪要')));

    expect(result.ok).toBe(false);
    expect(mockLLMAsk).not.toHaveBeenCalled();
  });

  it('run: bitable write failure does not block card output', async () => {
    mockFetchHistory.mockResolvedValueOnce({ ok: true, value: { messages: [], hasMore: false } });
    mockLLMAsk.mockResolvedValueOnce({ ok: true, value: VALID_LLM_RESPONSE });
    mockBitableBatchInsert.mockResolvedValue({ ok: false, error: { code: 'FEISHU_API_ERROR', message: 'bitable down' } });
    mockBitableInsert.mockResolvedValueOnce({ ok: false, error: { code: 'FEISHU_API_ERROR', message: 'bitable down' } });

    const result = await summarySkill.run(makeCtx(makeEvent('本次会议')));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.card?.templateName).toBe('summary');
  });

  it('run: LLM returns invalid JSON → falls back to empty extraction, still returns card', async () => {
    mockFetchHistory.mockResolvedValueOnce({ ok: true, value: { messages: [], hasMore: false } });
    mockLLMAsk.mockResolvedValueOnce({ ok: true, value: 'not json' });
    mockBitableInsert.mockResolvedValueOnce({ ok: true, value: { tableId: 't', recordId: 'r' } });

    const result = await summarySkill.run(makeCtx(makeEvent('会议纪要')));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.card?.content['decisions']).toEqual([]);
    }
    expect(mockBitableBatchInsert).not.toHaveBeenCalled(); // empty arrays → no batchInsert
  });
});
