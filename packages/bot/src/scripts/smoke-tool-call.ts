/**
 * smoke-tool-call.ts — 真实调用豆包验证 Function Calling 兼容性
 *
 * 运行：pnpm --filter @seedhac/bot dev:smoke-tool-call
 *
 * 目标：把 M1（chatWithTools）拿到火山方舟真实环境跑一遍，
 *      确认豆包对 OpenAI tool-call 协议的兼容性。
 *
 * 验证场景：
 *   1. 单工具调用：模型识别需要调工具 → 我们执行 → 回灌 → 模型给出最终答复
 *   2. 不必要的工具调用：问候类问题，模型应直接回答（无 tool_calls）
 *   3. maxToolCallRounds 上限：人工构造死循环，验证守卫生效
 */

import { createLLMClient } from '../llm-client.js';
import type { LLMTool, ToolCall, ToolResult } from '@seedhac/contracts';

const llm = createLLMClient();

function section(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ ${title}`);
  console.log('─'.repeat(60));
}

const TOOLS: LLMTool[] = [
  {
    name: 'lookup_project_memory',
    description: '查询 lark-loom 项目的常驻记忆。比如项目的目标、技术栈、红线。',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: '要查询的主题，例如 "技术栈" / "产品红线" / "项目目标"',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'list_skills',
    description: '列出当前机器人可用的所有 skill 及其一句话描述。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

function makeMockExecutor(): (call: ToolCall) => Promise<ToolResult> {
  return async (call) => {
    console.log(`  [executor] 收到 tool 调用: ${call.name}(${call.argumentsRaw})`);
    if (call.name === 'lookup_project_memory') {
      const args = JSON.parse(call.argumentsRaw) as { topic: string };
      const fake: Record<string, string> = {
        技术栈: 'Node 20 + TypeScript + 飞书 SDK + 火山方舟豆包 + 多维表格 + Chroma',
        产品红线: '不窃听 1v1、不存敏感信息、所有 API 调用走 BotRuntime 限流',
        项目目标: '飞书生态原生的群知识助手，把对话沉淀成可检索的项目记忆',
      };
      return {
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify({
          topic: args.topic,
          answer: fake[args.topic] ?? '（未找到此主题的记忆）',
        }),
      };
    }
    if (call.name === 'list_skills') {
      return {
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify([
          { name: 'qa', description: '群聊问答，需要 @bot 触发' },
          { name: 'recall', description: '检测信息缺口主动召回历史上下文' },
          { name: 'summary', description: '会议纪要 / 进度更新摘要' },
          { name: 'slides', description: '把 IM 对话转成演示文稿' },
        ]),
      };
    }
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({ error: 'unknown tool' }),
    };
  };
}

// ---------- 场景 1：单工具调用 ----------

section('场景 1 · 单工具调用 — 模型应该调 lookup_project_memory');

const r1 = await llm.chatWithTools(
  [
    {
      role: 'user',
      content: 'lark-loom 这个项目的产品红线是什么？请用工具查一下再回答。',
    },
  ],
  {
    model: 'pro',
    tools: TOOLS,
    executor: makeMockExecutor(),
  },
);

if (r1.ok) {
  console.log('✅ 成功');
  console.log(`轮数: ${r1.value.rounds}, 工具调用次数: ${r1.value.toolCalls.length}`);
  for (const tc of r1.value.toolCalls) {
    console.log(`  · ${tc.name}(${tc.argumentsRaw})`);
  }
  console.log('最终回答:', r1.value.content);
} else {
  console.error('❌ 失败:', r1.error);
  process.exit(1);
}

// ---------- 场景 2：不必要的工具调用 ----------

section('场景 2 · 闲聊 — 模型应该直接回答，不调工具');

const r2 = await llm.chatWithTools(
  [{ role: 'user', content: '你好，1+1 等于几？' }],
  {
    model: 'pro',
    tools: TOOLS,
    executor: makeMockExecutor(),
  },
);

if (r2.ok) {
  console.log('✅ 成功');
  console.log(`轮数: ${r2.value.rounds}, 工具调用次数: ${r2.value.toolCalls.length}`);
  console.log('最终回答:', r2.value.content);
  if (r2.value.toolCalls.length > 0) {
    console.warn('⚠️  注意：模型对闲聊也调了工具，prompt 设计需要优化');
  }
} else {
  console.error('❌ 失败:', r2.error);
  process.exit(1);
}

// ---------- 场景 3：maxToolCallRounds 上限 ----------

section('场景 3 · maxRounds 守卫 — 让模型多次调工具，验证 3 轮上限');

const r3 = await llm.chatWithTools(
  [
    {
      role: 'user',
      content:
        '请依次查询 项目目标、技术栈、产品红线 三个主题，每次只查一个，每查到一个简短复述一次，全部查完后再总结。',
    },
  ],
  {
    model: 'pro',
    tools: TOOLS,
    maxToolCallRounds: 3,
    executor: makeMockExecutor(),
  },
);

if (r3.ok) {
  console.log('✅ 成功');
  console.log(`轮数: ${r3.value.rounds}（上限 3）, 工具调用次数: ${r3.value.toolCalls.length}`);
  console.log('最终回答:', r3.value.content.slice(0, 200));
} else {
  console.error('❌ 失败:', r3.error);
  process.exit(1);
}

// ---------- 完成 ----------

console.log(`\n${'─'.repeat(60)}`);
console.log('🎉 chatWithTools 真实 API 验证完成');
console.log('─'.repeat(60));
