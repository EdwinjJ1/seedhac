/**
 * smoke-tool-call.ts — 真实调用豆包验证 chatWithTools（M1）
 *
 * 运行：pnpm --filter @seedhac/bot dev:smoke-tool-call
 *
 * 设计原则：模拟 M5 真实链路 —— 一条群消息进来，模型需要先用工具去
 * 检索"项目说明书 / skill 列表"，再决定怎么回。这是 lark-loom Harness
 * 架构的核心 use case，不用通用 weather demo 糊弄。
 *
 * ───────────── 场景 1：完整 Harness 链路 ─────────────
 *   群消息（用户问技术红线 + 求 ppt）
 *   → 极简 systemprompt 告诉模型「memory 在哪、skill.md 在哪」
 *   → 模型自主决定调用 lookup_project_memory + list_skills（最少 2 个工具）
 *   → 我们回灌真实数据
 *   → 模型给出最终回复，里面应同时引用「红线」+「下一步建议哪个 skill」
 *
 * ───────────── 场景 2：闲聊不调工具 ─────────────
 *   "1+1 等于几"  → 模型直接回答，不应触发工具
 *
 * ───────────── 场景 3：maxToolCallRounds 守卫 ─────────────
 *   prompt 让模型逐主题查询，maxRounds=2 强制截断
 *
 * ───────────── 场景 4：工具执行抛错隔离 ─────────────
 *   故意让 executor 抛错，验证错误被包成 ToolResult 回灌后
 *   模型能给出"查询失败"的合理降级回答
 */

import { createLLMClient } from '../llm-client.js';
import type { LLMTool, ToolCall, ToolResult, ChatMessage } from '@seedhac/contracts';

const llm = createLLMClient();

function section(title: string): void {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`▶ ${title}`);
  console.log('═'.repeat(70));
}

function divider(): void {
  console.log('─'.repeat(70));
}

// ────────────────────────────────────────────────────────────────────
// 工具定义：模拟 M3 将要实现的 4 个工具中的两个（最关键的两个）
// ────────────────────────────────────────────────────────────────────

const TOOLS: LLMTool[] = [
  {
    name: 'lookup_project_memory',
    description:
      '查询 lark-loom 项目的常驻记忆（项目目标、技术栈、产品红线、术语定义等）。' +
      '当用户问到项目相关的事实性问题时调用。',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: '主题关键词，例如 "技术栈" / "产品红线" / "项目目标" / "术语"',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'list_skills',
    description:
      '列出当前机器人可用的所有 skill 及其触发条件。当需要决定"用户这条消息该走哪个 skill 处理"时调用。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

// ────────────────────────────────────────────────────────────────────
// 极简 systemprompt（M3 OVERVIEW.md 思路的预演 — 控制在 ~1KB 以内）
// ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是 lark-loom 飞书群聊助手的内部路由 LLM。

【你的工作】
- 看到群消息后，判断是否需要调用工具检索项目记忆 / skill 列表
- 闲聊或常识问题 → 直接回答，**不要**乱调工具
- 涉及项目特定知识（技术栈/红线/术语）→ 调 lookup_project_memory
- 用户提出明确请求（写文档、做 ppt、归档项目）→ 调 list_skills 看可用 skill

【可用工具】
- lookup_project_memory(topic): 查项目常驻记忆
- list_skills(): 列出 skill 及触发方式

【输出格式】
完成查询后用一段话回复用户：先回答事实，再用一句话推荐下一步（如"建议 @我 触发 slides skill"）。
不要复述工具返回的原始 JSON。`;

// ────────────────────────────────────────────────────────────────────
// 真实 executor：返回 lark-loom 项目里有据可查的数据
// ────────────────────────────────────────────────────────────────────

const PROJECT_MEMORY: Record<string, string> = {
  技术栈:
    'Node 20+ / TypeScript 5 / pnpm monorepo / @larksuiteoapi/node-sdk v1.62 / 火山方舟豆包（Lite + Pro）/ 飞书多维表格（结构化记忆）/ ChromaDB（向量检索）',
  产品红线:
    '不监听 1v1 私聊；只在群聊响应；不存敏感信息（手机号/密码等）；所有 Lark API 调用必须走 BotRuntime 限流（100 req/min + 5 req/sec）',
  项目目标:
    '飞书生态原生的群知识助手 —— 把群聊对话沉淀成结构化项目记忆（多维表格 + 知识图谱），并在合适时机主动召回缺失的上下文',
  术语:
    'Skill = 业务能力（qa/recall/summary/slides/archive/weekly）；GapDetector = 信息缺口检测（规则+LLM 两层）；MessageBuffer = 消息批处理（30s 或 10 条触发）',
};

const PROJECT_SKILLS = [
  { name: 'qa', description: '群聊问答，需要 @bot，回答群相关问题', trigger: '@bot + 问题' },
  {
    name: 'recall',
    description: '检测信息缺口主动召回历史上下文（产品差异化）',
    trigger: '出现"那个东西/上次说的"等模糊指代',
  },
  { name: 'summary', description: '会议纪要 / 进度更新自动整理', trigger: '群里出现"会议纪要"等关键词' },
  { name: 'slides', description: 'IM 对话 → 演示文稿（飞书 docx）', trigger: '"做ppt"等关键词' },
  { name: 'archive', description: '项目全链路归档', trigger: '决赛阶段手动 @触发' },
  { name: 'weekly', description: '周报自动生成', trigger: 'cron 周一 09:00' },
];

function makeRealExecutor(opts: { failOn?: string } = {}): (call: ToolCall) => Promise<ToolResult> {
  return async (call) => {
    console.log(`  ↳ tool=${call.name} args=${call.argumentsRaw}`);

    if (opts.failOn && call.name === opts.failOn) {
      throw new Error(`模拟故障：${opts.failOn} 后端不可用`);
    }

    if (call.name === 'lookup_project_memory') {
      const args = JSON.parse(call.argumentsRaw) as { topic: string };
      const matchedKey = Object.keys(PROJECT_MEMORY).find(
        (k) => args.topic.includes(k) || k.includes(args.topic),
      );
      const answer = matchedKey ? PROJECT_MEMORY[matchedKey] : '（未找到此主题的记忆）';
      return {
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify({ topic: args.topic, matched: matchedKey ?? null, answer }),
      };
    }

    if (call.name === 'list_skills') {
      return {
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(PROJECT_SKILLS),
      };
    }

    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({ error: 'unknown tool' }),
    };
  };
}

// ────────────────────────────────────────────────────────────────────
// 场景 1：完整 Harness 链路（最重要的一个验证）
// ────────────────────────────────────────────────────────────────────

section('场景 1 · 完整 Harness 链路：群消息触发多工具协作');
console.log('用户消息：「lark-loom 项目的产品红线是什么？另外我想把今天的讨论做成 ppt，怎么搞？」');
divider();

const messages1: ChatMessage[] = [
  {
    role: 'user',
    content:
      'lark-loom 项目的产品红线是什么？另外我想把今天的讨论做成 ppt，怎么搞？',
  },
];

const t1 = Date.now();
const r1 = await llm.chatWithTools(messages1, {
  model: 'pro',
  systemPrompt: SYSTEM_PROMPT,
  tools: TOOLS,
  executor: makeRealExecutor(),
});
const dur1 = Date.now() - t1;

if (!r1.ok) {
  console.error('❌ 失败:', r1.error);
  process.exit(1);
}
console.log(`\n✅ 成功（耗时 ${dur1}ms，${r1.value.rounds} 轮，${r1.value.toolCalls.length} 次 tool 调用）`);
console.log('工具调用序列:');
for (const tc of r1.value.toolCalls) {
  console.log(`  · ${tc.name}(${tc.argumentsRaw})`);
}
console.log('\n模型最终回复:');
console.log(r1.value.content);

const mentionsRedLine =
  r1.value.content.includes('1v1') ||
  r1.value.content.includes('私聊') ||
  r1.value.content.includes('限流') ||
  r1.value.content.includes('敏感');
const mentionsSlides = r1.value.content.includes('slides') || r1.value.content.includes('ppt');
const usedBothTools =
  r1.value.toolCalls.some((c) => c.name === 'lookup_project_memory') &&
  r1.value.toolCalls.some((c) => c.name === 'list_skills');

console.log('\n验收:');
console.log(`  · 调用了两个工具（memory + skills）: ${usedBothTools ? '✅' : '❌'}`);
console.log(`  · 回复包含产品红线信息: ${mentionsRedLine ? '✅' : '❌'}`);
console.log(`  · 回复推荐了 slides skill: ${mentionsSlides ? '✅' : '❌'}`);
if (!usedBothTools || !mentionsRedLine || !mentionsSlides) {
  console.warn('⚠️  场景 1 验收未全部通过，可能需要调整 systemprompt 或工具描述');
}

// ────────────────────────────────────────────────────────────────────
// 场景 2：闲聊不调工具
// ────────────────────────────────────────────────────────────────────

section('场景 2 · 闲聊：不应触发工具');
console.log('用户消息：「你好，1+1 等于几？」');
divider();

const t2 = Date.now();
const r2 = await llm.chatWithTools(
  [{ role: 'user', content: '你好，1+1 等于几？' }],
  {
    model: 'pro',
    systemPrompt: SYSTEM_PROMPT,
    tools: TOOLS,
    executor: makeRealExecutor(),
  },
);
const dur2 = Date.now() - t2;

if (!r2.ok) {
  console.error('❌ 失败:', r2.error);
  process.exit(1);
}
console.log(`✅ 成功（耗时 ${dur2}ms，${r2.value.rounds} 轮，${r2.value.toolCalls.length} 次 tool 调用）`);
console.log('模型回复:', r2.value.content);
console.log(
  `\n验收 · 闲聊未调工具: ${r2.value.toolCalls.length === 0 ? '✅' : '⚠️  调了 ' + r2.value.toolCalls.length + ' 次（systemprompt 引导可能过强）'}`,
);

// ────────────────────────────────────────────────────────────────────
// 场景 3：maxToolCallRounds 守卫
// ────────────────────────────────────────────────────────────────────

section('场景 3 · maxRounds=2 强制截断');
console.log('用户消息：让模型依次查 4 个主题，但 maxRounds 只给 2');
divider();

const t3 = Date.now();
const r3 = await llm.chatWithTools(
  [
    {
      role: 'user',
      content:
        '请依次查询以下 4 个主题的项目记忆，每查到一个简短复述：项目目标、技术栈、产品红线、术语。每次只查一个主题，全部查完再总结。',
    },
  ],
  {
    model: 'pro',
    systemPrompt: SYSTEM_PROMPT,
    tools: TOOLS,
    maxToolCallRounds: 2,
    executor: makeRealExecutor(),
  },
);
const dur3 = Date.now() - t3;

if (!r3.ok) {
  console.error('❌ 失败:', r3.error);
  process.exit(1);
}
console.log(`✅ 成功（耗时 ${dur3}ms，${r3.value.rounds} 轮，${r3.value.toolCalls.length} 次 tool 调用）`);
console.log('模型回复（截断守卫触发后）:', r3.value.content.slice(0, 300));
console.log(`\n验收 · 轮数 ≤ 2: ${r3.value.rounds <= 2 ? '✅' : '❌'}`);

// ────────────────────────────────────────────────────────────────────
// 场景 4：工具抛错隔离
// ────────────────────────────────────────────────────────────────────

section('场景 4 · 工具 executor 抛错被隔离');
console.log('用户消息：「项目的术语怎么定义？」（lookup_project_memory 故意抛错）');
divider();

const t4 = Date.now();
const r4 = await llm.chatWithTools(
  [{ role: 'user', content: '项目的术语怎么定义？' }],
  {
    model: 'pro',
    systemPrompt: SYSTEM_PROMPT,
    tools: TOOLS,
    executor: makeRealExecutor({ failOn: 'lookup_project_memory' }),
  },
);
const dur4 = Date.now() - t4;

if (!r4.ok) {
  console.error('❌ 失败:', r4.error);
  process.exit(1);
}
console.log(`✅ 成功（耗时 ${dur4}ms，${r4.value.rounds} 轮，${r4.value.toolCalls.length} 次 tool 调用）`);
console.log('模型回复:', r4.value.content);
const handledError =
  r4.value.content.includes('失败') ||
  r4.value.content.includes('错误') ||
  r4.value.content.includes('暂时') ||
  r4.value.content.includes('不可用') ||
  r4.value.content.includes('无法');
console.log(`\n验收 · 模型在错误下给出合理降级回复: ${handledError ? '✅' : '⚠️  未明确说明失败'}`);

// ────────────────────────────────────────────────────────────────────
// 总结
// ────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(70)}`);
console.log('🎉 chatWithTools 真实 API 验证完成');
console.log(`总耗时: ${dur1 + dur2 + dur3 + dur4}ms`);
console.log('═'.repeat(70));
