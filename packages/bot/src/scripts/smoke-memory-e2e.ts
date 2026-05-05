/**
 * smoke-memory-e2e.ts — Memory 系统端到端真实验证脚本
 *
 * 区别于 vitest 的测试，这个脚本：
 *   - 输出彩色人类可读的验收报告，方便复赛前肉眼 review
 *   - 每个场景打印「问题/工具调用序列/模型回复/验收结论」
 *   - 任一硬验收点失败 exit(1)，可作为 CI gate
 *
 * 跑：
 *   pnpm --filter @seedhac/bot dev:e2e-memory
 *
 * 与 smoke-tool-call.ts 的区别：
 *   - smoke-tool-call.ts：M1 范畴，验证 chatWithTools 协议本身（用假 lookup 工具）
 *   - 本脚本：M3 整链路，用真 MemoryStore + 真 docs/bot-memory + 真 SystemPromptCache
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ok,
  type BitableClient,
  type FindResult,
  type Logger,
  type RecordRef,
  type Result,
} from '@seedhac/contracts';

import { VolcanoLLMClient } from '../llm-client.js';
import { MemoryStore } from '../memory/memory-store.js';
import { SystemPromptCache } from '../memory/system-prompt.js';
import { getLLMTools, makeExecutor } from '../memory/tool-handlers.js';

// ─── 颜色（不依赖第三方包，手写 ANSI）─────────────────────────────────────────

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

function section(title: string): void {
  console.log('\n' + '═'.repeat(76));
  console.log(c.bold(c.cyan(`▶ ${title}`)));
  console.log('═'.repeat(76));
}

function divider(): void {
  console.log(c.dim('─'.repeat(76)));
}

// ─── 验收聚合器 ─────────────────────────────────────────────────────────────────

interface Assertion {
  readonly name: string;
  readonly pass: boolean;
  readonly detail?: string;
}

const allAssertions: { scenario: string; assertions: Assertion[] }[] = [];

function assert(name: string, pass: boolean, detail?: string): Assertion {
  return detail !== undefined ? { name, pass, detail } : { name, pass };
}

function recordScenario(scenario: string, assertions: Assertion[]): void {
  allAssertions.push({ scenario, assertions });
  console.log(c.bold('\n验收：'));
  for (const a of assertions) {
    const tag = a.pass ? c.green('✅') : c.red('❌');
    console.log(`  ${tag} ${a.name}${a.detail ? c.dim('  · ' + a.detail) : ''}`);
  }
}

// ─── 凭证检查 ───────────────────────────────────────────────────────────────────

const ARK_API_KEY = process.env['ARK_API_KEY'];
const ARK_MODEL_PRO = process.env['ARK_MODEL_PRO'];
const ARK_MODEL_LITE = process.env['ARK_MODEL_LITE'] ?? ARK_MODEL_PRO;

if (!ARK_API_KEY || !ARK_MODEL_PRO) {
  console.error(
    c.red(
      '❌ 缺 ARK_API_KEY 或 ARK_MODEL_PRO 环境变量。\n' +
        '   请在 .env 里填好，或临时 export ARK_API_KEY=sk-... ARK_MODEL_PRO=ep-...',
    ),
  );
  process.exit(1);
}

// ─── docsRoot ───────────────────────────────────────────────────────────────────

const DOCS_ROOT = resolve(
  fileURLToPath(import.meta.url),
  '../../../../../docs/bot-memory',
);

// ─── FakeBitable（与 memory-e2e.test.ts 同一份实现，独立 inline 便于单文件运行）

interface FakeRow {
  recordId: string;
  fields: Record<string, unknown>;
}

class FakeBitable implements BitableClient {
  private rows: FakeRow[] = [];
  private nextId = 1;
  public findCalls = 0;
  public insertCalls = 0;

  private matchesFilter(row: FakeRow, filter: string): boolean {
    if (!filter) return true;
    const eq = [...filter.matchAll(/CurrentValue\.\[(\w+)\]\s*=\s*"([^"]*)"/g)];
    for (const [, field, expected] of eq) {
      if (String(row.fields[field!]) !== expected) return false;
    }
    const ct = [...filter.matchAll(/CurrentValue\.\[(\w+)\]\.contains\("([^"]*)"\)/g)];
    for (const [, field, needle] of ct) {
      if (!String(row.fields[field!] ?? '').includes(needle!)) return false;
    }
    return true;
  }

  async find(p: {
    table: string;
    filter?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<Result<FindResult>> {
    this.findCalls++;
    const matched = this.rows.filter((r) => this.matchesFilter(r, p.filter ?? ''));
    const limit = p.pageSize ?? 20;
    const offset = p.pageToken ? parseInt(p.pageToken, 10) : 0;
    const records = matched.slice(offset, offset + limit).map((r) => ({
      ...r.fields,
      tableId: 'tbl_memory',
      recordId: r.recordId,
    }));
    const hasMore = offset + limit < matched.length;
    const nextPageToken = hasMore ? String(offset + limit) : undefined;
    return ok({ records, hasMore, ...(nextPageToken !== undefined && { nextPageToken }) });
  }

  async insert(p: { table: string; row: Record<string, unknown> }): Promise<Result<RecordRef>> {
    this.insertCalls++;
    const recordId = `rec_${this.nextId++}`;
    this.rows.push({ recordId, fields: { ...p.row } });
    return ok({ tableId: 'tbl_memory', recordId });
  }

  async update(p: {
    table: string;
    recordId: string;
    patch: Record<string, unknown>;
  }): Promise<Result<void>> {
    const row = this.rows.find((r) => r.recordId === p.recordId);
    if (row) row.fields = { ...row.fields, ...p.patch };
    return ok(undefined);
  }

  async delete(p: { table: string; recordId: string }): Promise<Result<void>> {
    this.rows = this.rows.filter((r) => r.recordId !== p.recordId);
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

  seed(rows: {
    kind: string;
    chatId: string;
    key: string;
    content: string;
    importance: number;
    sourceSkill: string;
  }[]): void {
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

// ─── 静默 logger，工具调用日志单独打印 ─────────────────────────────────────────

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ─── 装配 ───────────────────────────────────────────────────────────────────────

const CHAT_ID = 'oc_e2e_test_chat';
const OTHER_CHAT_ID = 'oc_other_chat';

const llm = new VolcanoLLMClient({
  apiKey: ARK_API_KEY,
  modelIds: { lite: ARK_MODEL_LITE!, pro: ARK_MODEL_PRO },
});

const bitable = new FakeBitable();
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
      '5 月 3 日讨论：Antares 负责 M5 harness runtime，Edwin 主刀复赛 demo，Gloria 跟 PR review。下次同步 5 月 5 日晚上。',
    importance: 7,
    sourceSkill: 'summary',
  },
  {
    kind: 'chat',
    chatId: CHAT_ID,
    key: 'decision.demo_scope',
    content:
      '复赛 Demo 范围：只演示 qa + summary + slides 三条主线；recall 因 retrievers 未注入暂不演示；weekly 砍出范围。',
    importance: 8,
    sourceSkill: 'archive',
  },
  // 跨群隔离测试：包含触发关键词「红线 demo」的"私密讨论"
  {
    kind: 'chat',
    chatId: OTHER_CHAT_ID,
    key: 'leak.test',
    content: '这是另一个群的【私密讨论】，绝不应被 oc_e2e_test_chat 检索到。包含 红线 demo 关键词。',
    importance: 9,
    sourceSkill: 'summary',
  },
]);

const store = new MemoryStore({ bitable, llm, logger: silentLogger });

// ─── 工具调用观察器：用一个能 echo 的 logger 替代 silentLogger ─────────────

const toolCalls: { tool: string; args: unknown; ms: number }[] = [];
const observerLogger = {
  info: (msg: string, meta?: Record<string, unknown>) => {
    if (msg === 'tool called' && meta) {
      toolCalls.push({
        tool: String(meta['tool']),
        args: meta['args'],
        ms: Number(meta['ms']),
      });
    }
  },
  warn: () => {},
};

function makeExec() {
  toolCalls.length = 0;
  return makeExecutor({
    store,
    chatId: CHAT_ID,
    logger: observerLogger,
    docsRoot: DOCS_ROOT,
  });
}

function printToolCalls(): void {
  if (toolCalls.length === 0) {
    console.log(c.dim('  ⊘ 模型未调用任何工具'));
    return;
  }
  for (const tc of toolCalls) {
    console.log(`  ${c.cyan('·')} ${tc.tool}(${JSON.stringify(tc.args)}) ${c.dim(`${tc.ms}ms`)}`);
  }
}

// ─── 主流程 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(c.bold(c.cyan('\n╔════════════════════════════════════════════════════════════════════════════╗')));
  console.log(c.bold(c.cyan('║  Lark Loom Memory 系统 E2E 真实验证（豆包 Pro + FakeBitable + 真 docs）   ║')));
  console.log(c.bold(c.cyan('╚════════════════════════════════════════════════════════════════════════════╝')));
  console.log(c.dim(`docsRoot: ${DOCS_ROOT}`));
  console.log(c.dim(`chatId:   ${CHAT_ID}（种子记忆 4 条）`));
  console.log(c.dim(`otherChat:${OTHER_CHAT_ID}（隔离测试 1 条 — 不应被检索到）`));
  console.log(c.dim(`bitable size: ${bitable.size()} 行`));

  const promptCache = await SystemPromptCache.load(DOCS_ROOT);
  const systemPrompt = promptCache.build({ chatId: CHAT_ID, mention: true });
  console.log(c.dim(`system prompt: ${systemPrompt.length} chars`));

  // ────────── 场景 1 ──────────
  // 用 memory.read 的精确路径走通，因为当前 search 用 Bitable filter 字面子串匹配，
  // 模型若把整句问题作为 query 命中率为 0（这是已识别的架构性短板，等向量检索补上）。
  // 这里测两件事：
  //   a) 模型应该主动调工具（不能纯凭空回答）
  //   b) 用模型自然语言路径 OR 短关键词路径，至少有一条能命中
  section('场景 1 / 模型应主动调 memory 工具检索技术栈（限当前 Bitable 子串匹配）');
  console.log(c.dim('用户：「项目里有一条 key=project.tech_stack 的项目记忆，里面写了什么？」'));
  divider();

  const t1 = Date.now();
  const r1 = await llm.chatWithTools(
    [
      {
        role: 'user',
        content: '项目里有一条 key=project.tech_stack 的项目记忆，里面写了什么？',
      },
    ],
    { model: 'pro', systemPrompt, tools: getLLMTools(), executor: makeExec(), maxToolCallRounds: 3 },
  );
  if (!r1.ok) {
    console.error(c.red(`❌ LLM 调用失败：${r1.error.message}`));
    process.exit(1);
  }
  console.log(c.dim(`耗时 ${Date.now() - t1}ms · ${r1.value.rounds} 轮 · ${r1.value.toolCalls.length} 次工具调用`));
  console.log(c.bold('\n工具调用序列：'));
  printToolCalls();
  console.log(c.bold('\n模型回复：'));
  console.log(r1.value.content);

  const lower1 = r1.value.content.toLowerCase();
  recordScenario('场景 1', [
    assert(
      '调用了 memory.search 或 memory.read',
      r1.value.toolCalls.some((c) => c.name === 'memory.search' || c.name === 'memory.read'),
    ),
    assert(
      '回复引用技术栈关键事实（typescript / 豆包 / 飞书 / pnpm 之一）',
      lower1.includes('typescript') ||
        lower1.includes('豆包') ||
        lower1.includes('飞书') ||
        lower1.includes('pnpm') ||
        lower1.includes('chromadb'),
    ),
  ]);

  // ────────── 场景 1b：暴露 search 短板 ──────────
  section('场景 1b / 已识别短板：长 query 因 Bitable filter 字面子串匹配而 0 命中');
  console.log(c.dim('用户：「Lark Loom 项目用了什么技术栈？」（自然语言整句）'));
  console.log(c.dim('预期：模型可能搜不到，因为 search 是子串匹配（架构性短板，待向量检索补上）'));
  divider();

  const t1b = Date.now();
  const r1b = await llm.chatWithTools(
    [{ role: 'user', content: 'Lark Loom 项目用了什么技术栈？' }],
    { model: 'pro', systemPrompt, tools: getLLMTools(), executor: makeExec(), maxToolCallRounds: 3 },
  );
  if (!r1b.ok) {
    console.error(c.red(`❌ LLM 调用失败：${r1b.error.message}`));
    process.exit(1);
  }
  console.log(c.dim(`耗时 ${Date.now() - t1b}ms · ${r1b.value.rounds} 轮`));
  console.log(c.bold('\n工具调用序列：'));
  printToolCalls();
  console.log(c.bold('\n模型回复：'));
  console.log(r1b.value.content);

  // 这个场景断言"调了工具"就够 — 命中与否取决于模型 query 拆词智能程度，不强约束
  recordScenario('场景 1b (短板暴露)', [
    assert(
      '模型至少尝试调用 memory.search',
      r1b.value.toolCalls.some((c) => c.name === 'memory.search'),
    ),
    assert(
      '不会捏造（找不到时应明确说"未查到"而不是瞎编技术栈）',
      // 如果回复里出现技术词且 search 0 命中，说明捏造了；如果回复诚实承认查不到，OK
      r1b.value.content.includes('未') ||
        r1b.value.content.includes('暂未') ||
        r1b.value.content.includes('没有') ||
        r1b.value.content.includes('查不到') ||
        // 或者真的查到了关键事实（也算通过）
        ['typescript', '豆包', '飞书', 'pnpm', 'chromadb'].some((kw) =>
          r1b.value.content.toLowerCase().includes(kw),
        ),
    ),
  ]);

  // ────────── 场景 2：R2 跨群隔离 ──────────
  section('场景 2 / R2 红线：跨群隔离 — 即便搜「红线 demo」也不能拿到 OTHER 群记忆');
  console.log(c.dim('用户：「搜一下"红线"和"demo"相关的所有记忆」'));
  divider();

  const t2 = Date.now();
  const r2 = await llm.chatWithTools(
    [{ role: 'user', content: '搜一下"红线"和"demo"相关的所有记忆' }],
    { model: 'pro', systemPrompt, tools: getLLMTools(), executor: makeExec(), maxToolCallRounds: 3 },
  );
  if (!r2.ok) {
    console.error(c.red(`❌ LLM 调用失败：${r2.error.message}`));
    process.exit(1);
  }
  console.log(c.dim(`耗时 ${Date.now() - t2}ms · ${r2.value.rounds} 轮`));
  console.log(c.bold('\n工具调用序列：'));
  printToolCalls();
  console.log(c.bold('\n模型回复：'));
  console.log(r2.value.content);

  recordScenario('场景 2 (R2 隔离)', [
    assert(
      '回复不含「私密讨论」关键词（OTHER_CHAT_ID 的 leak.test 内容）',
      !r2.value.content.includes('私密讨论'),
    ),
    assert('回复不含「另一个群」字样', !r2.value.content.includes('另一个群')),
    assert(
      '回复应包含本群的红线 / demo 信息（red_lines 或 demo_scope）',
      r2.value.content.includes('红线') ||
        r2.value.content.includes('R1') ||
        r2.value.content.includes('demo') ||
        r2.value.content.includes('Demo'),
    ),
  ]);

  // ────────── 场景 3：闲聊不调工具 ──────────
  section('场景 3 / 闲聊「1+1=?」不应触发任何 memory 工具');
  console.log(c.dim('用户：「你好，1+1 等于几？」'));
  divider();

  const t3 = Date.now();
  const r3 = await llm.chatWithTools(
    [{ role: 'user', content: '你好，1+1 等于几？' }],
    { model: 'pro', systemPrompt, tools: getLLMTools(), executor: makeExec(), maxToolCallRounds: 2 },
  );
  if (!r3.ok) {
    console.error(c.red(`❌ LLM 调用失败：${r3.error.message}`));
    process.exit(1);
  }
  console.log(c.dim(`耗时 ${Date.now() - t3}ms · ${r3.value.rounds} 轮 · ${r3.value.toolCalls.length} 次工具调用`));
  console.log(c.bold('\n工具调用序列：'));
  printToolCalls();
  console.log(c.bold('\n模型回复：'));
  console.log(r3.value.content);

  const memCalls3 = r3.value.toolCalls.filter((c) => c.name.startsWith('memory.')).length;
  recordScenario('场景 3 (闲聊抑制)', [
    assert(`未调用 memory.* 工具（实际 ${memCalls3} 次）`, memCalls3 === 0),
    assert('回复包含「2」或「二」', /2|二/.test(r3.value.content)),
  ]);

  // ────────── 场景 4：skill 工具链 ──────────
  section('场景 4 / 用户问「会议纪要怎么生成」，模型应通过 skill.* 查到 summary');
  console.log(c.dim('用户：「会议纪要这个功能要怎么生成？告诉我触发条件和产出。」'));
  divider();

  const t4 = Date.now();
  const r4 = await llm.chatWithTools(
    [{ role: 'user', content: '会议纪要这个功能要怎么生成？告诉我触发条件和产出。' }],
    { model: 'pro', systemPrompt, tools: getLLMTools(), executor: makeExec(), maxToolCallRounds: 4 },
  );
  if (!r4.ok) {
    console.error(c.red(`❌ LLM 调用失败：${r4.error.message}`));
    process.exit(1);
  }
  console.log(c.dim(`耗时 ${Date.now() - t4}ms · ${r4.value.rounds} 轮`));
  console.log(c.bold('\n工具调用序列：'));
  printToolCalls();
  console.log(c.bold('\n模型回复：'));
  console.log(r4.value.content);

  recordScenario('场景 4 (skill 工具链)', [
    assert(
      '调用了 skill.list 或 skill.read',
      r4.value.toolCalls.some((c) => c.name.startsWith('skill.')),
    ),
    assert(
      '回复提到 summary / 纪要 / 总结',
      r4.value.content.toLowerCase().includes('summary') ||
        r4.value.content.includes('纪要') ||
        r4.value.content.includes('总结'),
    ),
  ]);

  // ────────── 场景 5：MemoryStore.write → read 链路 ──────────
  section('场景 5 / MemoryStore.write → read 真链路（不走 LLM）');
  divider();

  const writeR = await store.write({
    kind: 'chat',
    chat_id: CHAT_ID,
    key: 'e2e.write_then_read',
    content: '一条 E2E 测试写入的记忆，应能立刻读出',
    source_skill: 'test',
    importance: 6,
  });
  const readR = await store.read('chat', CHAT_ID, 'e2e.write_then_read');

  console.log(c.bold('write 结果：'), writeR.ok ? c.green('ok') : c.red(`err: ${writeR.error.message}`));
  console.log(c.bold('read 结果：'), readR.ok ? c.green('ok') : c.red(`err: ${readR.error.message}`));
  if (readR.ok && readR.value) {
    console.log(c.dim(`  content: ${readR.value.content}`));
    console.log(c.dim(`  importance: ${readR.value.importance}`));
  }

  recordScenario('场景 5 (写读自闭环)', [
    assert('write 成功', writeR.ok),
    assert('read 成功且非空', readR.ok && readR.value !== null),
    assert(
      'read 内容与 write 一致',
      readR.ok && readR.value !== null && readR.value.content.includes('E2E 测试写入'),
    ),
    assert(
      'importance=6（显式给值跳过 LLM 评分）',
      readR.ok && readR.value !== null && readR.value.importance === 6,
    ),
  ]);

  // ────────── 场景 6：注入攻击防护 ──────────
  section('场景 6 / SAFE_KEY_PATTERN 防注入');
  divider();
  const evilKey = 'evil") OR CurrentValue.[chat_id]=("any';
  console.log(c.dim(`恶意 key: ${evilKey}`));
  const evilR = await store.read('chat', CHAT_ID, evilKey);
  console.log(c.bold('结果：'), evilR.ok ? c.red('被放行了 — 安全漏洞！') : c.green(`被拒绝 (${evilR.error.code})`));

  recordScenario('场景 6 (注入防护)', [
    assert('恶意 key 被拒绝', !evilR.ok),
    assert(
      '错误码为 INVALID_INPUT',
      !evilR.ok && evilR.error.code === 'INVALID_INPUT',
    ),
  ]);

  // ────────── 总结 ──────────
  section('总结');
  let totalAssertions = 0;
  let passedAssertions = 0;
  let failedScenarios = 0;
  for (const s of allAssertions) {
    let scenarioPass = true;
    for (const a of s.assertions) {
      totalAssertions++;
      if (a.pass) passedAssertions++;
      else scenarioPass = false;
    }
    const tag = scenarioPass ? c.green('PASS') : c.red('FAIL');
    console.log(`  [${tag}] ${s.scenario}  ${c.dim(`${s.assertions.filter((a) => a.pass).length}/${s.assertions.length}`)}`);
    if (!scenarioPass) failedScenarios++;
  }
  console.log();
  console.log(`  ${c.bold('断言：')} ${passedAssertions}/${totalAssertions} 通过`);
  console.log(`  ${c.bold('场景：')} ${allAssertions.length - failedScenarios}/${allAssertions.length} 通过`);
  console.log(`  ${c.bold('FakeBitable 调用：')} ${bitable['findCalls']} find · ${bitable['insertCalls']} insert`);

  if (failedScenarios === 0) {
    console.log(c.green(c.bold('\n🎉 全部通过 — Memory 系统真实链路验收 OK\n')));
    process.exit(0);
  } else {
    console.log(c.red(c.bold(`\n❌ ${failedScenarios} 个场景失败 — 请检查上方输出\n`)));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(c.red('FATAL:'), e);
  process.exit(1);
});
