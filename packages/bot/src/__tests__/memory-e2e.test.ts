/**
 * Memory 系统端到端真实测试 — 调真豆包 + FakeBitable
 *
 * 验收 Memory 全链路：
 *   群消息 → SystemPromptCache → llm.chatWithTools(memory tools) → tool-handlers
 *   → MemoryStore.read/search/write → FakeBitable → 回灌 → 模型最终回复
 *
 * 为什么用 FakeBitable 而不是真飞书表？
 *   - 不依赖飞书凭证就能跑，CI / 任何开发同学都能复现
 *   - 但 LLM 调用是真实豆包：验证模型是否真会调对工具、参数对不对、把回灌结果
 *     用得对不对——这才是 M3 Harness 设计的核心命题
 *
 * 跑法：
 *   ARK_API_KEY=sk-xxx ARK_MODEL_PRO=ep-xxx \
 *     pnpm --filter @seedhac/bot vitest run src/__tests__/memory-e2e.test.ts
 *
 *   或直接 pnpm --filter @seedhac/bot dev:e2e-memory（脚本里加载 .env）
 *
 * 缺 ARK_API_KEY 自动跳过整组（不污染 pnpm test 默认流水线）
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ok,
  type BitableClient,
  type FindResult,
  type LLMClient,
  type Logger,
  type RecordRef,
  type Result,
} from '@seedhac/contracts';

import { VolcanoLLMClient } from '../llm-client.js';
import { MemoryStore } from '../memory/memory-store.js';
import { SystemPromptCache } from '../memory/system-prompt.js';
import { getLLMTools, makeExecutor } from '../memory/tool-handlers.js';

// ─── 跳过条件：缺 ARK 凭证 ────────────────────────────────────────────────────

const ARK_API_KEY = process.env['ARK_API_KEY'];
const ARK_MODEL_PRO = process.env['ARK_MODEL_PRO'];
const ARK_MODEL_LITE = process.env['ARK_MODEL_LITE'] ?? ARK_MODEL_PRO;
const HAS_ARK = Boolean(ARK_API_KEY && ARK_MODEL_PRO);

const describeReal = HAS_ARK ? describe : describe.skip;

// ─── docsRoot：指向真实的 docs/bot-memory ───────────────────────────────────────

const DOCS_ROOT = resolve(
  fileURLToPath(import.meta.url),
  '../../../../../docs/bot-memory',
);

// ─── FakeBitable：内存存储，复用与 memory-store.test.ts 一致的接口 ─────────────

interface FakeRow {
  recordId: string;
  fields: Record<string, unknown>;
}

class FakeBitable implements BitableClient {
  private rows: FakeRow[] = [];
  private nextId = 1;
  public findCalls = 0;
  public insertCalls = 0;
  public updateCalls = 0;

  private matchesFilter(row: FakeRow, filter: string): boolean {
    if (!filter) return true;
    const eqMatches = [...filter.matchAll(/CurrentValue\.\[(\w+)\]\s*=\s*"([^"]*)"/g)];
    for (const [, field, expected] of eqMatches) {
      if (String(row.fields[field!]) !== expected) return false;
    }
    const containsMatches = [
      ...filter.matchAll(/CurrentValue\.\[(\w+)\]\.contains\("([^"]*)"\)/g),
    ];
    for (const [, field, needle] of containsMatches) {
      if (!String(row.fields[field!] ?? '').includes(needle!)) return false;
    }
    return true;
  }

  async find(params: {
    table: string;
    filter?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<Result<FindResult>> {
    this.findCalls++;
    const matched = this.rows.filter((r) => this.matchesFilter(r, params.filter ?? ''));
    const limit = params.pageSize ?? 20;
    const offset = params.pageToken ? parseInt(params.pageToken, 10) : 0;
    const records = matched.slice(offset, offset + limit).map((r) => ({
      ...r.fields,
      tableId: 'tbl_memory',
      recordId: r.recordId,
    }));
    const hasMore = offset + limit < matched.length;
    const nextPageToken = hasMore ? String(offset + limit) : undefined;
    return ok({ records, hasMore, ...(nextPageToken !== undefined && { nextPageToken }) });
  }

  async insert(params: {
    table: string;
    row: Record<string, unknown>;
  }): Promise<Result<RecordRef>> {
    this.insertCalls++;
    const recordId = `rec_${this.nextId++}`;
    this.rows.push({ recordId, fields: { ...params.row } });
    return ok({ tableId: 'tbl_memory', recordId });
  }

  async update(params: {
    table: string;
    recordId: string;
    patch: Record<string, unknown>;
  }): Promise<Result<void>> {
    this.updateCalls++;
    const row = this.rows.find((r) => r.recordId === params.recordId);
    if (row) {
      // 不可变写法（项目硬约束）
      row.fields = { ...row.fields, ...params.patch };
    }
    return ok(undefined);
  }

  async delete(params: { table: string; recordId: string }): Promise<Result<void>> {
    this.rows = this.rows.filter((r) => r.recordId !== params.recordId);
    return ok(undefined);
  }

  async batchInsert(): Promise<Result<readonly RecordRef[]>> {
    return ok([]);
  }

  async link(): Promise<Result<void>> {
    return ok(undefined);
  }

  async readTable(): Promise<Result<string>> {
    return ok('');
  }

  /** 测试辅助：植入种子数据，绕过 importance 评分 */
  seed(rows: { kind: string; chatId: string; key: string; content: string; importance: number; sourceSkill: string }[]): void {
    const now = Date.now();
    for (const r of rows) {
      this.rows.push({
        recordId: `rec_${this.nextId++}`,
        fields: {
          kind: r.kind,
          chat_id: r.chatId,
          key: r.key,
          content: r.content,
          importance: r.importance,
          last_access: now,
          created_at: now,
          source_skill: r.sourceSkill,
        },
      });
    }
  }

  size(): number {
    return this.rows.length;
  }
}

// ─── 静默 logger（避免测试输出污染） ────────────────────────────────────────

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ─── 测试主体 ─────────────────────────────────────────────────────────────────

describeReal('Memory E2E (真豆包 + FakeBitable)', () => {
  let llm: LLMClient;
  let bitable: FakeBitable;
  let store: MemoryStore;
  let promptCache: SystemPromptCache;

  const CHAT_ID = 'oc_e2e_test_chat';
  const OTHER_CHAT_ID = 'oc_other_chat';

  beforeAll(async () => {
    llm = new VolcanoLLMClient({
      apiKey: ARK_API_KEY!,
      modelIds: { lite: ARK_MODEL_LITE!, pro: ARK_MODEL_PRO! },
    });

    bitable = new FakeBitable();
    store = new MemoryStore({ bitable, llm, logger: silentLogger });

    // 当前群的种子记忆 —— 模型应该能通过 memory.search 检索到
    bitable.seed([
      {
        kind: 'project',
        chatId: CHAT_ID,
        key: 'project.tech_stack',
        content:
          'Lark Loom 技术栈：Node 20 + TypeScript 5 + pnpm monorepo + 飞书 OpenSDK v1.62 + 火山方舟豆包（Lite/Pro 双模型）+ 飞书多维表格作语义记忆 + ChromaDB 作向量检索',
        importance: 9,
        sourceSkill: 'archive',
      },
      {
        kind: 'project',
        chatId: CHAT_ID,
        key: 'project.red_lines',
        content:
          'Lark Loom 产品红线：R1 不主动推未触发的 Skill 结果（recall 例外但需明确缺口）；R2 不读非本群消息；R3 卡片不暴露 record_id；R4 Bitable 写原子；R5 不超 10 QPS；R6 不存敏感个人信息',
        importance: 10,
        sourceSkill: 'archive',
      },
      {
        kind: 'chat',
        chatId: CHAT_ID,
        key: 'meeting.20260503',
        content:
          '5 月 3 日讨论：Antares 负责 M5 harness runtime，Edwin 主刀复赛 demo 准备，Gloria 跟 PR review。下次同步定在 5 月 5 日晚上。',
        importance: 7,
        sourceSkill: 'summary',
      },
      {
        kind: 'chat',
        chatId: CHAT_ID,
        key: 'decision.demo_scope',
        content:
          '复赛 Demo 范围决定：只演示 qa + summary + slides 三条主线；recall 因 retrievers 未注入暂不演示；weekly 砍出范围。',
        importance: 8,
        sourceSkill: 'archive',
      },
      // 跨群记忆 —— 用来验证 R2 隔离：不能被本群查到
      {
        kind: 'chat',
        chatId: OTHER_CHAT_ID,
        key: 'leak.test',
        content: '这是另一个群的私密讨论，绝不应该被 oc_e2e_test_chat 查到。包含关键词 红线 demo',
        importance: 9,
        sourceSkill: 'summary',
      },
    ]);

    promptCache = await SystemPromptCache.load(DOCS_ROOT);
  }, 30_000);

  // ──────────────────────────────────────────────────────────────────────
  // 验收 1：模型主动调 memory 工具并基于回灌作答
  // 注意：当前 MemoryStore.search 用 Bitable filter 字面子串匹配，长 query 命中率低
  //   （这是已识别的架构性短板，等向量检索补上）。
  // 这里用 key 提示让模型走 memory.read 精确路径，先把"链路打通"这件事钉死。
  // 真实场景下 search 的命中能力由场景 1b 暴露。
  // ──────────────────────────────────────────────────────────────────────
  it('AC-1：模型应主动调 memory 工具并基于回灌作答（用 key 提示走 read 精确路径）', async () => {
    const systemPrompt = promptCache.build({ chatId: CHAT_ID, mention: true });
    const executor = makeExecutor({
      store,
      chatId: CHAT_ID,
      logger: silentLogger,
      docsRoot: DOCS_ROOT,
    });

    const result = await llm.chatWithTools(
      [
        {
          role: 'user',
          content:
            '项目里有一条 key=project.tech_stack 的项目记忆，里面写了什么？',
        },
      ],
      {
        model: 'pro',
        systemPrompt,
        tools: getLLMTools(),
        executor,
        maxToolCallRounds: 3,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const v = result.value;
    const calledSearchOrRead = v.toolCalls.some(
      (c) => c.name === 'memory.search' || c.name === 'memory.read',
    );
    expect(calledSearchOrRead, '模型应调用 memory.search 或 memory.read').toBe(true);

    const lower = v.content.toLowerCase();
    const mentionsTech =
      lower.includes('typescript') ||
      lower.includes('豆包') ||
      lower.includes('飞书') ||
      lower.includes('node') ||
      lower.includes('pnpm') ||
      lower.includes('chromadb');
    expect(mentionsTech, `回复应引用技术栈事实，实际：${v.content}`).toBe(true);
  }, 60_000);

  // ──────────────────────────────────────────────────────────────────────
  // 验收 1b：暴露 search 短板 — 长 query 因子串匹配 0 命中时模型应诚实承认
  // ──────────────────────────────────────────────────────────────────────
  it('AC-1b：长 query 命中率低时模型应诚实回复"未查到"，不捏造', async () => {
    const systemPrompt = promptCache.build({ chatId: CHAT_ID, mention: true });
    const executor = makeExecutor({
      store,
      chatId: CHAT_ID,
      logger: silentLogger,
      docsRoot: DOCS_ROOT,
    });

    const result = await llm.chatWithTools(
      [{ role: 'user', content: 'Lark Loom 项目用了什么技术栈？' }],
      {
        model: 'pro',
        systemPrompt,
        tools: getLLMTools(),
        executor,
        maxToolCallRounds: 3,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const triedSearch = result.value.toolCalls.some((c) => c.name === 'memory.search');
    expect(triedSearch, '模型至少应尝试 memory.search').toBe(true);

    // 没查到应诚实回复，或者真的查到了关键事实（也算通过 — 模型 query 拆词智能）
    const honestOrFound =
      result.value.content.includes('未') ||
      result.value.content.includes('暂未') ||
      result.value.content.includes('没有') ||
      result.value.content.includes('查不到') ||
      ['typescript', '豆包', '飞书', 'pnpm', 'chromadb'].some((kw) =>
        result.value.content.toLowerCase().includes(kw),
      );
    expect(honestOrFound, `不应捏造内容，实际：${result.value.content}`).toBe(true);
  }, 60_000);

  // ──────────────────────────────────────────────────────────────────────
  // 验收 2：R2 跨群隔离 —— 模型不能查到 OTHER_CHAT_ID 的记忆
  // ──────────────────────────────────────────────────────────────────────
  it('AC-2：R2 隔离 — 即便模型搜"红线 demo"也不能拿到 OTHER_CHAT_ID 的记忆', async () => {
    const systemPrompt = promptCache.build({ chatId: CHAT_ID, mention: true });
    const executor = makeExecutor({
      store,
      chatId: CHAT_ID,
      logger: silentLogger,
      docsRoot: DOCS_ROOT,
    });

    const result = await llm.chatWithTools(
      [{ role: 'user', content: '搜一下"红线"和"demo"相关的所有记忆' }],
      {
        model: 'pro',
        systemPrompt,
        tools: getLLMTools(),
        executor,
        maxToolCallRounds: 3,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 关键断言：跨群泄漏关键词"私密讨论"不应出现在回复里
    expect(result.value.content).not.toContain('私密讨论');
    expect(result.value.content).not.toContain('另一个群');
    // FakeBitable 的 find 调用应当全部带 chat_id="oc_e2e_test_chat" filter，
    // 不会有调用拿到 OTHER_CHAT_ID 的行（这是契约层断言）
    // 这里通过断言"另一个群的 key" 确实没出现也间接验证
  }, 60_000);

  // ──────────────────────────────────────────────────────────────────────
  // 验收 3：模型该不调工具就不调（闲聊）
  // ──────────────────────────────────────────────────────────────────────
  it('AC-3：闲聊"1+1=?" 不应触发任何 memory 工具', async () => {
    const systemPrompt = promptCache.build({ chatId: CHAT_ID, mention: true });
    const executor = makeExecutor({
      store,
      chatId: CHAT_ID,
      logger: silentLogger,
      docsRoot: DOCS_ROOT,
    });

    const result = await llm.chatWithTools(
      [{ role: 'user', content: '你好，1+1 等于几？' }],
      {
        model: 'pro',
        systemPrompt,
        tools: getLLMTools(),
        executor,
        maxToolCallRounds: 2,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const memoryCallCount = result.value.toolCalls.filter((c) =>
      c.name.startsWith('memory.'),
    ).length;
    expect(memoryCallCount, '闲聊不应调 memory 工具').toBe(0);
    expect(result.value.content).toMatch(/2|二/);
  }, 60_000);

  // ──────────────────────────────────────────────────────────────────────
  // 验收 4：skill.list / skill.read 链路通
  // ──────────────────────────────────────────────────────────────────────
  it('AC-4：用户问"会议纪要怎么生成"时，模型应通过 skill.list+skill.read 查到 summary skill', async () => {
    const systemPrompt = promptCache.build({ chatId: CHAT_ID, mention: true });
    const executor = makeExecutor({
      store,
      chatId: CHAT_ID,
      logger: silentLogger,
      docsRoot: DOCS_ROOT,
    });

    const result = await llm.chatWithTools(
      [
        {
          role: 'user',
          content: '会议纪要这个功能要怎么生成？告诉我触发条件和产出。',
        },
      ],
      {
        model: 'pro',
        systemPrompt,
        tools: getLLMTools(),
        executor,
        maxToolCallRounds: 4,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const usedSkillTool = result.value.toolCalls.some((c) => c.name.startsWith('skill.'));
    expect(usedSkillTool, '应使用 skill.list 或 skill.read').toBe(true);

    const lower = result.value.content.toLowerCase();
    expect(
      lower.includes('summary') || result.value.content.includes('纪要') || result.value.content.includes('总结'),
      `回复应提到 summary 或 纪要：${result.value.content}`,
    ).toBe(true);
  }, 120_000);

  // ──────────────────────────────────────────────────────────────────────
  // 验收 5：MemoryStore 真写入 + 真读出（链路自闭环）
  // ──────────────────────────────────────────────────────────────────────
  it('AC-5：MemoryStore.write → read 全链路（不依赖 LLM 评分，importance 显式给）', async () => {
    const writeResult = await store.write({
      kind: 'chat',
      chat_id: CHAT_ID,
      key: 'e2e.write_then_read',
      content: '一条 E2E 测试写入的记忆，应当能被立刻读出来',
      source_skill: 'test',
      importance: 6, // 显式给，跳过 LLM 评分队列
    });
    expect(writeResult.ok).toBe(true);

    const readResult = await store.read('chat', CHAT_ID, 'e2e.write_then_read');
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;

    expect(readResult.value).not.toBeNull();
    expect(readResult.value!.content).toContain('E2E 测试写入');
    expect(readResult.value!.importance).toBe(6);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 验收 6：注入攻击防护 —— 恶意 key 应被拒绝
  // ──────────────────────────────────────────────────────────────────────
  it('AC-6：含特殊字符的 key 应被 SAFE_KEY_PATTERN 拒绝', async () => {
    const result = await store.read(
      'chat',
      CHAT_ID,
      'evil") OR CurrentValue.[chat_id]=("any',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
  });
});
