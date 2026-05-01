/**
 * smoke-cards.ts — 7 种卡片群发冒烟脚本
 *
 * 用法：
 *   1. 在根目录 .env 填好 LARK_APP_ID / LARK_APP_SECRET / TEST_CHAT_ID
 *   2. pnpm --filter @seedhac/bot dev:smoke
 *
 * 环境变量（从根目录 .env 自动读取）：
 *   LARK_APP_ID      飞书应用 App ID
 *   LARK_APP_SECRET  飞书应用 App Secret
 *   TEST_CHAT_ID     测试群的 chat_id（oc_ 开头）
 */

import * as lark from '@larksuiteoapi/node-sdk';
import { larkCardBuilder } from '../card-builder.js';

// ─── 环境变量读取 ──────────────────────────────────────────────────────────────

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`❌ 缺少环境变量: ${key}`);
    process.exit(1);
  }
  return val;
}

const APP_ID = required('LARK_APP_ID');
const APP_SECRET = required('LARK_APP_SECRET');
const CHAT_ID = required('TEST_CHAT_ID');

// ─── 飞书客户端 ────────────────────────────────────────────────────────────────

const client = new lark.Client({ appId: APP_ID, appSecret: APP_SECRET });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendCard(label: string, cardContent: Record<string, unknown>): Promise<void> {
  console.log(`\n📤 发送: ${label}`);
  try {
    const res = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: CHAT_ID,
        msg_type: 'interactive',
        content: JSON.stringify(cardContent),
      },
    });
    if (res.code === 0) {
      console.log(`   ✅ 成功 message_id=${res.data?.message_id}`);
    } else {
      console.error(`   ❌ 失败 code=${res.code} msg=${res.msg}`);
    }
  } catch (e: unknown) {
    const apiErr = (e as { response?: { data?: { code?: number; msg?: string } } })?.response?.data;
    if (apiErr) {
      console.error(`   ❌ API错误 code=${apiErr.code} msg=${apiErr.msg}`);
    } else {
      console.error(`   ❌ 异常`, e instanceof Error ? e.message : e);
    }
  }
}

// ─── 主逻辑 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🚀 Lark Loom CardBuilder 冒烟测试');
  console.log(`   chat_id: ${CHAT_ID}`);
  console.log('─'.repeat(50));

  // 1. qa
  await sendCard(
    'qa — 智能问答',
    larkCardBuilder.build('qa', {
      question: '这个项目的复赛截止日期是什么时候？',
      answer: '根据时间节点，复赛日期为 **2026-05-06**，决赛答辩为 2026-05-14。',
      sources: [
        { title: 'README.md', kind: 'wiki', snippet: '时间节点表' },
        { title: '分工表', url: 'https://example.feishu.cn/bitable/xxx', kind: 'bitable' },
      ],
      buttons: [{ text: '查看 README', value: { action: 'open', target: 'readme' }, variant: 'primary' }],
    }).content,
  );
  await sleep(1000);

  // 2. recall
  await sendCard(
    'recall — 历史信息召回',
    larkCardBuilder.build('recall', {
      trigger: '之前讨论的那个技术选型',
      summary: '团队在 4 月 28 日碰头会上决定：使用 pnpm monorepo + 飞书 Card 2.0 + 火山方舟 LLM。',
      sources: [
        { title: '4/28 碰头会记录', kind: 'minutes' },
        { title: '群历史消息', kind: 'chat', snippet: '「用飞书自带的就行」' },
      ],
    }).content,
  );
  await sleep(1000);

  // 3. summary
  await sendCard(
    'summary — 会议总结',
    larkCardBuilder.build('summary', {
      title: '第二次碰头会 · 阶段总结',
      topics: ['CardBuilder 实现方案', 'Skill Router 设计', '飞书 API 权限申请进度'],
      decisions: ['CardBuilder 放在 bot 包', '所有 Skill 通过 SkillContext 拿依赖'],
      todos: [
        { text: '实现 LarkCardBuilder', assignee: 'Antares', due: '2026-05-06' },
        { text: '接入飞书 WSClient', assignee: 'Evan', due: '2026-05-06' },
        { text: '申请飞书消息权限', assignee: '沛彤' },
      ],
      followUps: ['确认 Card 2.0 interactive 回调地址', '补充单元测试覆盖率'],
    }).content,
  );
  await sleep(1000);

  // 4. slides
  await sendCard(
    'slides — 演示文稿',
    larkCardBuilder.build('slides', {
      title: '业务探索方向汇报',
      presentationUrl: 'https://example.feishu.cn/slides/xxx',
      pageCount: 4,
      preview: [
        { title: '背景与机会', bullets: ['市场空间分析', '竞品对比'] },
        { title: '我们的方案', bullets: ['Lark Loom Agent', '核心差异化：主动召回'] },
        { title: '技术实现', bullets: ['飞书 Card 2.0', 'pnpm monorepo + 7 条 Skill 主线'] },
        { title: '下一步', bullets: ['MVP 上线', '用户反馈收集', '迭代节奏'] },
      ],
    }).content,
  );
  await sleep(1000);

  // 5. archive
  await sendCard(
    'archive — 归档',
    larkCardBuilder.build('archive', {
      recordId: 'rec_archive_20260514',
      title: '业务探索项目 · 最终归档',
      bitableUrl: 'https://example.feishu.cn/bitable/archive',
      tags: ['2026-Q2', '飞书挑战赛', '已完成', 'LarkLoom'],
    }).content,
  );
  await sleep(1000);

  // 6. crossChat
  await sendCard(
    'crossChat — 跨群检索',
    larkCardBuilder.build('crossChat', {
      query: '飞书 API 消息卡片发送权限',
      hits: [
        {
          chatId: 'oc_tech',
          chatName: '技术讨论群',
          snippet: '需要申请 im:message:send_as_bot 权限，在开放平台后台配置。',
          timestamp: Date.now() - 86400000,
        },
        {
          chatId: 'oc_infra',
          chatName: '基础设施群',
          snippet: '我们已经申请了，在审核中，预计明天下来。',
          timestamp: Date.now() - 3600000,
        },
      ],
    }).content,
  );
  await sleep(1000);

  // 7. weekly
  await sendCard(
    'weekly — 周报',
    larkCardBuilder.build('weekly', {
      weekRange: '2026-04-29 ~ 2026-05-05',
      highlights: ['CardBuilder 7 种模板全部实现', '单元测试 16 个全绿', '分工表多维表格接入完成'],
      decisions: ['CardBuilder 放 bot 包不抽独立包', '测试脚本用 tsx 直接跑，不 build'],
      todos: ['WSClient 长连接接入', 'Skill Router 实现', '冒烟测试截图贴 PR'],
      metrics: { 'Skill 完成数': 3, 'PR 合并数': 2, '测试覆盖率(%)': 94 },
    }).content,
  );

  console.log('\n─'.repeat(50));
  console.log('✅ 全部发送完毕，截图后贴到 PR #18。');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
