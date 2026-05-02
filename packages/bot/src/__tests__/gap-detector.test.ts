import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GapDetector } from '../gap-detector.js';

const mockLLMAsk = vi.fn();
const mockLLM = { ask: mockLLMAsk, chat: vi.fn(), askStructured: vi.fn() };

function makeDetector(): GapDetector {
  return new GapDetector(mockLLM as never);
}

function makeMessage(name: string, text: string) {
  return {
    messageId: 'msg_1',
    chatId: 'chat_1',
    chatType: 'group' as const,
    sender: { userId: 'u1', name },
    contentType: 'text' as const,
    text,
    rawContent: text,
    mentions: [],
    timestamp: Date.now(),
  };
}

describe('GapDetector', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns shouldRecall:false immediately when messages is empty', async () => {
    const result = await makeDetector().detect([]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.shouldRecall).toBe(false);
      expect(mockLLMAsk).not.toHaveBeenCalled();
    }
  });

  it('returns shouldRecall:true when LLM detects a gap', async () => {
    mockLLMAsk.mockResolvedValueOnce({
      ok: true,
      value: '{"shouldRecall":true,"reason":"有人问了但没人回答","query":"上次会议结论"}',
    });

    const result = await makeDetector().detect([makeMessage('Alice', '上次我们决定的方案是什么来着？')]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.shouldRecall).toBe(true);
      expect(result.value.reason).toBe('有人问了但没人回答');
      expect(result.value.query).toBe('上次会议结论');
    }
  });

  it('returns shouldRecall:false when LLM says no gap', async () => {
    mockLLMAsk.mockResolvedValueOnce({
      ok: true,
      value: '{"shouldRecall":false,"reason":"","query":""}',
    });

    const result = await makeDetector().detect([makeMessage('Bob', '今天天气不错')]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.shouldRecall).toBe(false);
    }
  });

  it('falls back to shouldRecall:false when LLM fails', async () => {
    mockLLMAsk.mockResolvedValueOnce({ ok: false, error: { code: 'LLM_TIMEOUT', message: 'timeout' } });

    const result = await makeDetector().detect([makeMessage('Alice', '那个预算是多少来着')]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.shouldRecall).toBe(false);
      expect(result.value.reason).toBe('');
    }
  });

  it('falls back to shouldRecall:false when LLM returns invalid JSON', async () => {
    mockLLMAsk.mockResolvedValueOnce({ ok: true, value: 'not json at all' });

    const result = await makeDetector().detect([makeMessage('Alice', '我记得好像上次说过')]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.shouldRecall).toBe(false);
    }
  });

  it('strips markdown code fences before parsing JSON', async () => {
    mockLLMAsk.mockResolvedValueOnce({
      ok: true,
      value: '```json\n{"shouldRecall":true,"reason":"有未解答的问题","query":"项目截止日期"}\n```',
    });

    const result = await makeDetector().detect([makeMessage('Carol', '截止日期是哪天来着')]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.shouldRecall).toBe(true);
      expect(result.value.query).toBe('项目截止日期');
    }
  });
});
