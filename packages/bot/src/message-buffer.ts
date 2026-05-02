/**
 * MessageBuffer — 滑窗批处理（cost-control 核心）
 *
 * 每条群消息都过 LLM 缺口检测会烧钱。本类负责把消息攒成批，
 * 在以下任一条件触发时统一 flush 给 onFlush 处理：
 *   1. 累积到 batchSize 条
 *   2. 距首条消息超过 windowMs
 *   3. 检测到 strongSignals 关键词 — 立即 flush，不等批
 *
 * 多 chatId 隔离：每个 chatId 有独立缓冲区与独立 timer。
 */

import type { Message } from '@seedhac/contracts';

export interface MessageBufferConfig {
  /** 窗口时长（毫秒），默认 30000 */
  readonly windowMs: number;
  /** 攒满即 flush，默认 10 */
  readonly batchSize: number;
  /** 命中即立即 flush 的强信号正则；为空 = 不启用强信号短路 */
  readonly strongSignals: readonly RegExp[];
}

export type FlushHandler = (
  chatId: string,
  messages: readonly Message[],
) => Promise<void> | void;

interface ChatState {
  buffer: Message[];
  timer: NodeJS.Timeout | null;
}

export const DEFAULT_STRONG_SIGNALS: readonly RegExp[] = [
  /是多少来着/,
  /那个数据/,
  /上次.{0,6}(数据|结果|说|聊|讲|定|决定)/,
  /我记得/,
];

export class MessageBuffer {
  private readonly states = new Map<string, ChatState>();
  private stopped = false;

  constructor(
    private readonly config: MessageBufferConfig,
    private readonly onFlush: FlushHandler,
  ) {}

  push(msg: Message): void {
    if (this.stopped) return;

    const state = this.getOrCreateState(msg.chatId);
    state.buffer.push(msg);

    // 强信号 → 立即 flush
    if (this.matchesStrongSignal(msg.text)) {
      void this.flushState(msg.chatId, state);
      return;
    }

    // 攒满 batchSize → 立即 flush
    if (state.buffer.length >= this.config.batchSize) {
      void this.flushState(msg.chatId, state);
      return;
    }

    // 首条消息：启动窗口 timer
    if (state.buffer.length === 1 && state.timer === null) {
      state.timer = setTimeout(() => {
        void this.flushState(msg.chatId, state);
      }, this.config.windowMs);
    }
  }

  /** 手动触发 flush（外部调用，比如 SIGINT 前清空） */
  async flush(chatId: string): Promise<void> {
    const state = this.states.get(chatId);
    if (!state) return;
    await this.flushState(chatId, state);
  }

  /** 停止：清所有 timer + flush 所有剩余缓冲区 */
  async stop(): Promise<void> {
    this.stopped = true;
    const chatIds = Array.from(this.states.keys());
    await Promise.all(chatIds.map((id) => this.flush(id)));
  }

  private getOrCreateState(chatId: string): ChatState {
    let state = this.states.get(chatId);
    if (!state) {
      state = { buffer: [], timer: null };
      this.states.set(chatId, state);
    }
    return state;
  }

  private matchesStrongSignal(text: string): boolean {
    return this.config.strongSignals.some((re) => re.test(text));
  }

  private async flushState(chatId: string, state: ChatState): Promise<void> {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.buffer.length === 0) return;

    const batch = state.buffer;
    state.buffer = [];

    try {
      await this.onFlush(chatId, batch);
    } catch (e) {
      // onFlush 抛错不能让 buffer 死掉；调用方应在 handler 内自己处理错误。
      // 这里仅吞掉避免 unhandled rejection。
      console.error('[MessageBuffer] onFlush threw:', e);
    }
  }
}
