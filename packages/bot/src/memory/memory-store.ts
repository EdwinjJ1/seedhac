/**
 * MemoryStore — Bitable 之上的语义化记忆层。
 *
 * 职责：
 *   - read / search / write / score 4 个语义化方法
 *   - 大小护栏：单条 ≤ 2KB（硬截断）、单 chat 同 kind ≤ 200 条、全表 ≤ 2000 条
 *   - 淘汰：score = importance * 0.7 + recency * 0.3，淘汰最低分
 *   - importance 评分批量化：30s 窗口聚合，降低 LLM 成本
 *   - 命中时刷新 last_access（驱动 LRU recency）
 *
 * 设计取舍：
 *   - 不直接暴露 BitableClient 的 RecordRef / find 等底层 API
 *   - 调用方拿到 MemoryRecord，不关心飞书 record_id（id 字段只在内部用于淘汰删除）
 *   - LLM 评分队列与主路径解耦：write 立即返回（importance=-1），后台 30s 触发评分
 */

import {
  type BitableClient,
  type LLMClient,
  type MemoryRecord,
  type MemoryKind,
  type MemoryWriteInput,
  type Result,
  ok,
  err,
  ErrorCode,
  makeError,
} from '@seedhac/contracts';

// ---------- 限制常量 ----------

export const MEMORY_MAX_CONTENT_BYTES = 2 * 1024;
export const MEMORY_MAX_PER_CHAT_KIND = 200;
export const MEMORY_MAX_TOTAL = 2000;
export const MEMORY_SCORE_FLUSH_MS = 30_000;
const MEMORY_TABLE = 'memory' as const;
const MEMORY_PENDING_SCORE = -1;

// ---------- 配置 ----------

export interface MemoryStoreConfig {
  readonly bitable: BitableClient;
  /** 可选：注入 LLM 后启用 importance 评分；不注入则全部记忆停留在 -1 不参与淘汰排序 */
  readonly llm?: LLMClient;
  /** 评分批量窗口（默认 30s）；测试时可调小 */
  readonly scoreFlushMs?: number;
  /** 当前时间提供者（测试用）*/
  readonly now?: () => number;
}

// ---------- 评分队列 ----------

interface PendingScore {
  readonly recordId: string;
  readonly content: string;
}

// ---------- 工具函数 ----------

/**
 * 按 UTF-8 字节数硬截断；不会撕裂 UTF-8 多字节字符。
 * 实现：用 strict decoder 二分回退到最后一个合法字符边界。
 */
function truncateBytes(s: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) return s;
  const strict = new TextDecoder('utf-8', { fatal: true });
  // UTF-8 字符最长 4 字节，最多回退 3 个字节即可命中边界
  for (let cut = maxBytes; cut >= maxBytes - 3 && cut >= 0; cut--) {
    try {
      return strict.decode(bytes.slice(0, cut));
    } catch {
      // 切到了多字节字符中间，再退一字节
    }
  }
  return ''; // 极端边界（maxBytes < 4）
}

/**
 * 计算淘汰分数：importance 70% + recency 30%
 * recency = 1 - clamp(daysSinceAccess / 30, 0, 1)，30 天前的记忆 recency=0
 * importance < 0（未评分）按 5 处理，避免新记忆被立即淘汰
 */
export function evictScore(
  record: Pick<MemoryRecord, 'importance' | 'last_access'>,
  now: number,
): number {
  const imp = record.importance < 0 ? 5 : record.importance;
  const days = (now - record.last_access) / (24 * 3600 * 1000);
  const recency = 1 - Math.min(Math.max(days / 30, 0), 1);
  return imp * 0.7 + recency * 0.3 * 10; // 把 recency 拉到 0-10 范围与 imp 匹配
}

// ---------- MemoryStore ----------

export class MemoryStore {
  private readonly bitable: BitableClient;
  private readonly llm?: LLMClient;
  private readonly scoreFlushMs: number;
  private readonly now: () => number;
  private scoreQueue: PendingScore[] = [];
  private scoreTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  constructor(config: MemoryStoreConfig) {
    this.bitable = config.bitable;
    if (config.llm !== undefined) this.llm = config.llm;
    this.scoreFlushMs = config.scoreFlushMs ?? MEMORY_SCORE_FLUSH_MS;
    this.now = config.now ?? Date.now;
  }

  // ─────────────────────────── read ───────────────────────────

  /**
   * 按 (kind, chat_id, key) 精确读取单条记忆。
   * 命中时异步刷新 last_access（不阻塞返回）。
   */
  async read(
    kind: MemoryKind,
    chatId: string,
    key: string,
  ): Promise<Result<MemoryRecord | null>> {
    const findResult = await this.bitable.find({
      table: MEMORY_TABLE,
      filter: this.buildFilter({ kind, chat_id: chatId, key }),
      pageSize: 1,
    });
    if (!findResult.ok) return findResult;

    const record = findResult.value.records[0];
    if (!record) return ok(null);

    const memory = this.rowToMemory(record);
    // fire-and-forget：刷新 last_access
    void this.touchAccess(record.recordId).catch(() => {});
    return ok(memory);
  }

  // ─────────────────────────── search ───────────────────────────

  /**
   * 按 chat_id + 关键词模糊查询。
   * filter 用飞书 CurrentValue.[content].contains("keyword") 语法。
   * 命中后批量刷新 last_access（异步，不阻塞返回）。
   */
  async search(
    chatId: string,
    query: string,
    opts: { limit?: number; kind?: MemoryKind } = {},
  ): Promise<Result<readonly MemoryRecord[]>> {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
    const filter = this.buildSearchFilter(chatId, query, opts.kind);

    const findResult = await this.bitable.find({
      table: MEMORY_TABLE,
      filter,
      pageSize: limit,
    });
    if (!findResult.ok) return findResult;

    const memories = findResult.value.records.map((r) => this.rowToMemory(r));
    // 批量刷新 last_access
    void Promise.all(
      findResult.value.records.map((r) => this.touchAccess(r.recordId).catch(() => {})),
    );
    return ok(memories);
  }

  // ─────────────────────────── write ───────────────────────────

  /**
   * upsert 语义：
   *   1. 同 (kind, chat_id, key) 已存在 → update content + last_access，importance 保留
   *   2. 不存在 → insert + 入评分队列
   *   3. 单条 content 超 2KB → 硬截断
   *   4. 写入后异步检查容量，超限触发淘汰
   */
  async write(input: MemoryWriteInput): Promise<Result<MemoryRecord>> {
    const now = this.now();
    const content = truncateBytes(input.content, MEMORY_MAX_CONTENT_BYTES);

    // 查现有
    const existing = await this.read(input.kind, input.chat_id, input.key);
    if (!existing.ok) return existing;

    if (existing.value) {
      // upsert: update content + bump last_access
      const updateResult = await this.bitable.update({
        table: MEMORY_TABLE,
        recordId: existing.value.id!,
        patch: {
          content,
          last_access: now,
          ...(input.importance !== undefined && { importance: input.importance }),
        },
      });
      if (!updateResult.ok) return updateResult;
      return ok({
        ...existing.value,
        content,
        last_access: now,
        ...(input.importance !== undefined && { importance: input.importance }),
      });
    }

    // 新增
    const importance = input.importance ?? MEMORY_PENDING_SCORE;
    const row: Record<string, unknown> = {
      kind: input.kind,
      chat_id: input.chat_id,
      key: input.key,
      content,
      importance,
      last_access: now,
      created_at: now,
      source_skill: input.source_skill,
    };
    if (input.user_id !== undefined) row.user_id = input.user_id;

    const insertResult = await this.bitable.insert({ table: MEMORY_TABLE, row });
    if (!insertResult.ok) return insertResult;

    const record: MemoryRecord = {
      id: insertResult.value.recordId,
      kind: input.kind,
      chat_id: input.chat_id,
      key: input.key,
      content,
      importance,
      last_access: now,
      created_at: now,
      source_skill: input.source_skill,
      ...(input.user_id !== undefined && { user_id: input.user_id }),
    };

    // 评分队列（仅未指定 importance 且 LLM 可用时）
    if (input.importance === undefined && this.llm) {
      this.enqueueScore({ recordId: insertResult.value.recordId, content });
    }

    // 容量护栏（异步 fire-and-forget）
    void this.enforceCapacity(input.kind, input.chat_id).catch(() => {});

    return ok(record);
  }

  // ─────────────────────────── score（LLM 评分） ───────────────────────────

  /**
   * 给单条 content 打 importance 分数（0-10）。
   * 调用方一般不直接调，由 write 入队后批量调用。
   */
  async score(content: string): Promise<Result<number>> {
    if (!this.llm) {
      return err(makeError(ErrorCode.CONFIG_MISSING, 'score: llm not configured'));
    }

    const schema = {
      parse: (v: unknown): { importance: number } => {
        const obj = v as { importance?: unknown };
        if (typeof obj.importance !== 'number') throw new Error('importance not a number');
        const n = Math.max(0, Math.min(10, Math.round(obj.importance)));
        return { importance: n };
      },
      jsonSchema: () => ({
        type: 'object',
        properties: {
          importance: {
            type: 'number',
            description: '记忆重要性 0-10。10=项目级红线/关键决策；5=普通对话上下文；0=噪声',
          },
        },
        required: ['importance'],
      }),
    };

    const result = await this.llm.askStructured(
      `请给以下记忆条目打一个 importance 分数（0-10）。\n\n内容：\n${content}\n\n评分参考：\n10 = 项目目标/技术红线/关键决策\n7 = 重要的上下文（用户偏好、历史结论）\n5 = 普通对话/工作信息\n3 = 偶发提及\n0 = 噪声/无意义内容`,
      schema,
      { model: 'lite', maxTokens: 64 },
    );
    if (!result.ok) return result;
    return ok(result.value.importance);
  }

  /** 立即把评分队列里的任务执行完（测试用，绕过定时器） */
  async flushScoreQueue(): Promise<void> {
    if (this.scoreTimer) {
      clearTimeout(this.scoreTimer);
      this.scoreTimer = undefined;
    }
    const queue = this.scoreQueue;
    this.scoreQueue = [];
    for (const item of queue) {
      const scoreResult = await this.score(item.content);
      if (!scoreResult.ok) continue;
      await this.bitable
        .update({
          table: MEMORY_TABLE,
          recordId: item.recordId,
          patch: { importance: scoreResult.value },
        })
        .catch(() => {});
    }
  }

  // ─────────────────────────── 内部 ───────────────────────────

  private enqueueScore(item: PendingScore): void {
    this.scoreQueue.push(item);
    if (!this.scoreTimer) {
      this.scoreTimer = setTimeout(() => {
        void this.flushScoreQueue();
      }, this.scoreFlushMs);
    }
  }

  private async touchAccess(recordId: string): Promise<void> {
    await this.bitable.update({
      table: MEMORY_TABLE,
      recordId,
      patch: { last_access: this.now() },
    });
  }

  /** 容量护栏：当前 chat+kind > 200 → 淘汰最低分；全表 > 2000 → 全表淘汰最低分 */
  private async enforceCapacity(kind: MemoryKind, chatId: string): Promise<void> {
    // 单 chat+kind 计数（fetch 一页 200，超 200 就触发）
    const perChatResult = await this.bitable.find({
      table: MEMORY_TABLE,
      filter: this.buildFilter({ kind, chat_id: chatId }),
      pageSize: MEMORY_MAX_PER_CHAT_KIND + 1,
    });
    if (perChatResult.ok && perChatResult.value.records.length > MEMORY_MAX_PER_CHAT_KIND) {
      await this.evictLowest(perChatResult.value.records.map((r) => this.rowToMemory(r)), 1);
    }

    // 全表计数
    const totalResult = await this.bitable.find({
      table: MEMORY_TABLE,
      pageSize: MEMORY_MAX_TOTAL + 1,
    });
    if (totalResult.ok && totalResult.value.records.length > MEMORY_MAX_TOTAL) {
      await this.evictLowest(totalResult.value.records.map((r) => this.rowToMemory(r)), 1);
    }
  }

  private async evictLowest(candidates: readonly MemoryRecord[], n: number): Promise<void> {
    const now = this.now();
    const sorted = [...candidates].sort((a, b) => evictScore(a, now) - evictScore(b, now));
    const toDelete = sorted.slice(0, n);
    for (const m of toDelete) {
      if (!m.id) continue;
      await this.bitable
        .delete({ table: MEMORY_TABLE, recordId: m.id })
        .catch(() => {});
    }
  }

  private buildFilter(eq: Record<string, string>): string {
    // 飞书 filter 语法：CurrentValue.[字段] = "值" 用 AND 连接
    const conditions = Object.entries(eq).map(
      ([k, v]) => `CurrentValue.[${k}] = "${this.escapeFilterValue(v)}"`,
    );
    return `AND(${conditions.join(', ')})`;
  }

  private buildSearchFilter(chatId: string, query: string, kind?: MemoryKind): string {
    const parts = [
      `CurrentValue.[chat_id] = "${this.escapeFilterValue(chatId)}"`,
      `CurrentValue.[content].contains("${this.escapeFilterValue(query)}")`,
    ];
    if (kind) parts.push(`CurrentValue.[kind] = "${kind}"`);
    return `AND(${parts.join(', ')})`;
  }

  /** 转义飞书 filter 字符串字面量中的双引号和反斜杠 */
  private escapeFilterValue(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private rowToMemory(row: Record<string, unknown> & { recordId: string }): MemoryRecord {
    return {
      id: row.recordId,
      kind: row.kind as MemoryKind,
      chat_id: String(row.chat_id ?? ''),
      ...(typeof row.user_id === 'string' && row.user_id ? { user_id: row.user_id } : {}),
      key: String(row.key ?? ''),
      content: String(row.content ?? ''),
      importance: typeof row.importance === 'number' ? row.importance : MEMORY_PENDING_SCORE,
      last_access: typeof row.last_access === 'number' ? row.last_access : 0,
      created_at: typeof row.created_at === 'number' ? row.created_at : 0,
      source_skill: String(row.source_skill ?? ''),
    };
  }
}
