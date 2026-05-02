import { describe, it, expect, vi, beforeEach } from 'vitest';
import { archiveSkill } from '../archive.js';
import type { SkillContext, BotEvent, Message } from '@seedhac/contracts';

const mockLLMAsk = vi.fn();
const mockBitableFind = vi.fn();

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
    runtime: { fetchHistory: vi.fn(), sendText: vi.fn(), sendCard: vi.fn(), patchCard: vi.fn(), on: vi.fn(), start: vi.fn(), stop: vi.fn() },
    llm: { ask: mockLLMAsk, chat: vi.fn(), askStructured: vi.fn() },
    bitable: { find: mockBitableFind, insert: vi.fn(), batchInsert: vi.fn(), update: vi.fn(), delete: vi.fn(), link: vi.fn() },
    retrievers: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as SkillContext;
}

const EMPTY_FIND = { ok: true, value: { records: [], hasMore: false } };

describe('archiveSkill', () => {
  beforeEach(() => vi.clearAllMocks());

  it('match returns true when message contains 归档', () => {
    expect(archiveSkill.match(makeCtx(makeEvent('项目结束，我们归档一下')))).toBe(true);
  });

  it('match returns true for 复盘', () => {
    expect(archiveSkill.match(makeCtx(makeEvent('来做一个复盘')))).toBe(true);
  });

  it('match returns false for unrelated message', () => {
    expect(archiveSkill.match(makeCtx(makeEvent('下次会议安排')))).toBe(false);
  });

  it('match returns false for non-message event', () => {
    const ctx = makeCtx({ type: 'botJoinedChat', payload: { chatId: 'c', inviter: { userId: 'u' }, timestamp: 0 } });
    expect(archiveSkill.match(ctx)).toBe(false);
  });

  it('run normal path: bitable.find called 3 times, archive card returned', async () => {
    mockBitableFind
      .mockResolvedValueOnce({ ok: true, value: { records: [{ tableId: 't', recordId: 'r1', content: '完成了功能开发', chatId: 'chat_1' }], hasMore: false } })
      .mockResolvedValueOnce({ ok: true, value: { records: [{ tableId: 't', recordId: 'r2', content: '采用方案A', chatId: 'chat_1' }], hasMore: false } })
      .mockResolvedValueOnce({ ok: true, value: { records: [{ tableId: 't', recordId: 'r3', content: '完成登录', status: 'done', chatId: 'chat_1' }], hasMore: false } });
    mockLLMAsk.mockResolvedValueOnce({ ok: true, value: '项目圆满收尾，核心功能全部上线，决策1条，任务完成率100%。' });

    const result = await archiveSkill.run(makeCtx(makeEvent('项目结束，归档一下')));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.card?.templateName).toBe('archive');
      expect(result.value.card?.content['summary']).toContain('项目');
    }
    expect(mockBitableFind).toHaveBeenCalledTimes(3);
  });

  it('run: LLM failure returns err', async () => {
    mockBitableFind.mockResolvedValue(EMPTY_FIND);
    mockLLMAsk.mockResolvedValueOnce({ ok: false, error: { code: 'LLM_TIMEOUT', message: 'timeout' } });

    const result = await archiveSkill.run(makeCtx(makeEvent('收尾归档')));

    expect(result.ok).toBe(false);
  });

  it('run: bitable.find partial failure — uses available data, still proceeds', async () => {
    mockBitableFind
      .mockResolvedValueOnce({ ok: false, error: { code: 'FEISHU_API_ERROR', message: 'fail' } })
      .mockResolvedValueOnce(EMPTY_FIND)
      .mockResolvedValueOnce(EMPTY_FIND);
    mockLLMAsk.mockResolvedValueOnce({ ok: true, value: '项目总结' });

    const result = await archiveSkill.run(makeCtx(makeEvent('归档')));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.card?.templateName).toBe('archive');
  });

  it('run: bitable.find passes chatId filter', async () => {
    mockBitableFind.mockResolvedValue(EMPTY_FIND);
    mockLLMAsk.mockResolvedValueOnce({ ok: true, value: '总结' });

    await archiveSkill.run(makeCtx(makeEvent('复盘')));

    expect(mockBitableFind).toHaveBeenCalledWith(
      expect.objectContaining({ filter: expect.stringContaining('chat_1') }),
    );
  });
});
