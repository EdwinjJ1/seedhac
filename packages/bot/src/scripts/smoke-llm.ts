/**
 * smoke-llm.ts — LLMClient 真实调用验证脚本
 *
 * 运行：pnpm --filter @seedhac/bot dev:smoke-llm
 *
 * 验证场景：
 *   1. ask        — pro 模型返回纯文本
 *   2. askStructured — 返回经 schema 验证的 JSON 对象
 *   3. ask (lite) — lite 模型可正常调用
 */

import { createLLMClient } from '../llm-client.js';

const llm = createLLMClient();

function section(title: string): void {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`▶ ${title}`);
  console.log('─'.repeat(50));
}

// ---------- 场景 1：ask（pro）----------

section('场景 1 · ask — pro 模型');

const askResult = await llm.ask('用一句话介绍飞书是什么产品。', { model: 'pro' });

if (askResult.ok) {
  console.log('✅ 成功');
  console.log('回答:', askResult.value);
} else {
  console.error('❌ 失败:', askResult.error);
  process.exit(1);
}

// ---------- 场景 2：askStructured ----------

section('场景 2 · askStructured — 返回结构化 JSON');

const schema = {
  parse(v: unknown): { product: string; platform: string; slogan: string } {
    const obj = v as Record<string, unknown>;
    if (typeof obj.product !== 'string') throw new Error('missing product');
    if (typeof obj.platform !== 'string') throw new Error('missing platform');
    if (typeof obj.slogan !== 'string') throw new Error('missing slogan');
    return obj as { product: string; platform: string; slogan: string };
  },
  jsonSchema() {
    return {
      type: 'object',
      properties: {
        product: { type: 'string', description: '产品名称' },
        platform: { type: 'string', description: '所属平台' },
        slogan: { type: 'string', description: '一句话 slogan' },
      },
      required: ['product', 'platform', 'slogan'],
    };
  },
};

const structuredResult = await llm.askStructured(
  '请用 JSON 格式描述飞书这个产品。',
  schema,
  { model: 'pro' },
);

if (structuredResult.ok) {
  console.log('✅ 成功');
  console.log('解析结果:', JSON.stringify(structuredResult.value, null, 2));
} else {
  console.error('❌ 失败:', structuredResult.error);
  process.exit(1);
}

// ---------- 场景 3：ask（lite）----------

section('场景 3 · ask — lite 模型');

const liteResult = await llm.ask('1 + 1 等于几？', { model: 'lite' });

if (liteResult.ok) {
  console.log('✅ 成功');
  console.log('回答:', liteResult.value);
} else {
  console.error('❌ 失败:', liteResult.error);
  process.exit(1);
}

// ---------- 完成 ----------

console.log(`\n${'─'.repeat(50)}`);
console.log('🎉 全部场景通过，LLMClient 真实调用验证完成');
console.log('─'.repeat(50));
