import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageBuffer, DEFAULT_STRONG_SIGNALS } from '../message-buffer.js';
import type { Message } from '@seedhac/contracts';

let counter = 0;
function makeMsg(chatId: string, text: string): Message {
  counter += 1;
  return {
    messageId: `msg_${counter}`,
    chatId,
    chatType: 'group',
    sender: { userId: 'u1' },
    contentType: 'text',
    text,
    rawContent: text,
    mentions: [],
    timestamp: 1_700_000_000_000 + counter,
  };
}

describe('MessageBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    counter = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flush after batchSize messages reached', () => {
    const onFlush = vi.fn();
    const buf = new MessageBuffer(
      { windowMs: 30_000, batchSize: 3, strongSignals: [] },
      onFlush,
    );

    buf.push(makeMsg('chat_a', 'hi'));
    buf.push(makeMsg('chat_a', 'hello'));
    expect(onFlush).not.toHaveBeenCalled();

    buf.push(makeMsg('chat_a', 'yo'));
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]![0]).toBe('chat_a');
    expect(onFlush.mock.calls[0]![1]).toHaveLength(3);
  });

  it('flush after windowMs elapses even if batch not full', () => {
    const onFlush = vi.fn();
    const buf = new MessageBuffer(
      { windowMs: 30_000, batchSize: 10, strongSignals: [] },
      onFlush,
    );

    buf.push(makeMsg('chat_a', 'one'));
    buf.push(makeMsg('chat_a', 'two'));

    vi.advanceTimersByTime(29_999);
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]![1]).toHaveLength(2);
  });

  it('strong signal triggers immediate flush', () => {
    const onFlush = vi.fn();
    const buf = new MessageBuffer(
      { windowMs: 30_000, batchSize: 10, strongSignals: DEFAULT_STRONG_SIGNALS },
      onFlush,
    );

    buf.push(makeMsg('chat_a', '今天天气不错'));
    buf.push(makeMsg('chat_a', 'Q3 数据是多少来着'));
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]![1]).toHaveLength(2);
  });

  it('isolates buffers per chatId', () => {
    const onFlush = vi.fn();
    const buf = new MessageBuffer(
      { windowMs: 30_000, batchSize: 2, strongSignals: [] },
      onFlush,
    );

    buf.push(makeMsg('chat_a', 'a1'));
    buf.push(makeMsg('chat_b', 'b1'));
    expect(onFlush).not.toHaveBeenCalled();

    buf.push(makeMsg('chat_a', 'a2'));
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]![0]).toBe('chat_a');
    expect(onFlush.mock.calls[0]![1]).toHaveLength(2);

    buf.push(makeMsg('chat_b', 'b2'));
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush.mock.calls[1]![0]).toBe('chat_b');
  });

  it('manual flush() empties one chat without affecting others', async () => {
    const onFlush = vi.fn();
    const buf = new MessageBuffer(
      { windowMs: 30_000, batchSize: 10, strongSignals: [] },
      onFlush,
    );

    buf.push(makeMsg('chat_a', 'a1'));
    buf.push(makeMsg('chat_b', 'b1'));

    await buf.flush('chat_a');
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]![0]).toBe('chat_a');

    await buf.flush('chat_b');
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it('stop() clears timers and flushes all buffers', async () => {
    const onFlush = vi.fn();
    const buf = new MessageBuffer(
      { windowMs: 30_000, batchSize: 10, strongSignals: [] },
      onFlush,
    );

    buf.push(makeMsg('chat_a', 'a1'));
    buf.push(makeMsg('chat_b', 'b1'));

    await buf.stop();

    expect(onFlush).toHaveBeenCalledTimes(2);

    // 进一步 advance timer 不应再触发任何 flush
    vi.advanceTimersByTime(60_000);
    expect(onFlush).toHaveBeenCalledTimes(2);

    // stop 后再 push 也应被忽略
    buf.push(makeMsg('chat_a', 'should be ignored'));
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it('does not start a new timer when buffer already has items', () => {
    const onFlush = vi.fn();
    const buf = new MessageBuffer(
      { windowMs: 30_000, batchSize: 10, strongSignals: [] },
      onFlush,
    );

    buf.push(makeMsg('chat_a', 'm1'));
    vi.advanceTimersByTime(15_000);
    buf.push(makeMsg('chat_a', 'm2')); // 不应重置 timer
    vi.advanceTimersByTime(15_001);

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]![1]).toHaveLength(2);
  });

  it('onFlush throwing does not break the buffer for subsequent batches', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFlush = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    const buf = new MessageBuffer(
      { windowMs: 30_000, batchSize: 1, strongSignals: [] },
      onFlush,
    );

    buf.push(makeMsg('chat_a', 'first'));
    // microtask 排队，等一拍
    await Promise.resolve();
    await Promise.resolve();

    buf.push(makeMsg('chat_a', 'second'));
    await Promise.resolve();
    await Promise.resolve();

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
