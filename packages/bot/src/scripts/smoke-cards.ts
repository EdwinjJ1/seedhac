/**
 * smoke-cards.ts — 主链路卡片群发冒烟脚本
 *
 * 用法：
 *   1. 在根目录 .env 填好 LARK_APP_ID / LARK_APP_SECRET / TEST_CHAT_ID
 *   2. pnpm --filter @seedhac/bot dev:smoke
 *
 * 发送顺序与主链路一致：
 *   activation → docPush → tablePush → qa → summary → slides → archive
 *   → offlineSummary → docChange → weekly
 */

import * as lark from '@larksuiteoapi/node-sdk';
import { larkCardBuilder } from '../card-builder.js';

function required(key: string): string {
  const val = process.env[key];
  if (!val) { console.error(`❌ 缺少环境变量: ${key}`); process.exit(1); }
  return val;
}

const APP_ID = required('LARK_APP_ID');
const APP_SECRET = required('LARK_APP_SECRET');
const CHAT_ID = required('TEST_CHAT_ID');

const client = new lark.Client({ appId: APP_ID, appSecret: APP_SECRET });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function send(label: string, content: Record<string, unknown>): Promise<void> {
  console.log(`\n📤 ${label}`);
  try {
    const res = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: CHAT_ID, msg_type: 'interactive', content: JSON.stringify(content) },
    });
    if (res.code === 0) console.log(`   ✅ message_id=${res.data?.message_id}`);
    else console.error(`   ❌ code=${res.code} msg=${res.msg}`);
  } catch (e: unknown) {
    const apiErr = (e as { response?: { data?: { code?: number; msg?: string } } })?.response?.data;
    if (apiErr) console.error(`   ❌ API ${apiErr.code}: ${apiErr.msg}`);
    else console.error(`   ❌`, e instanceof Error ? e.message : e);
  }
}

async function main(): Promise<void> {
  console.log('🚀 Lark Loom CardBuilder 冒烟测试');
  console.log(`   chat_id: ${CHAT_ID}\n${'─'.repeat(50)}`);

  await send('1/10 activation — 激活确认', larkCardBuilder.build('activation', {
    chatName: 'Lark Loom 测试群',
    description: '自动整理需求、管理分工、生成汇报材料，无需 @ 触发。',
  }).content);
  await sleep(800);

  await send('2/10 docPush — 需求文档推送', larkCardBuilder.build('docPush', {
    docTitle: '业务探索需求文档 v1',
    docUrl: 'https://example.feishu.cn/docs/req',
    docType: 'requirement',
    summary: '梳理了核心用户场景与验收标准，共 3 个功能模块。',
  }).content);
  await sleep(800);

  await send('3/10 tablePush — 分工表推送', larkCardBuilder.build('tablePush', {
    tableTitle: '业务探索 · 分工表',
    bitableUrl: 'https://example.feishu.cn/bitable/tasks',
    taskCount: 6,
    members: ['Antares', 'Evan', '沛彤'],
    nearestDue: '2026-05-06',
  }).content);
  await sleep(800);

  await send('4/10 qa — 智能问答', larkCardBuilder.build('qa', {
    question: '复赛的截止时间是什么时候？',
    answer: '根据时间节点，**复赛为 2026-05-06**，决赛答辩为 2026-05-14。',
    sources: [
      { title: 'README.md', kind: 'wiki', snippet: '时间节点表' },
      { title: '分工表', url: 'https://example.feishu.cn/bitable/tasks', kind: 'bitable' },
    ],
  }).content);
  await sleep(800);

  await send('5/10 summary — 会议总结', larkCardBuilder.build('summary', {
    title: '第二次碰头会 · 阶段总结',
    topics: ['CardBuilder 实现方案', 'Skill Router 设计'],
    decisions: ['CardBuilder 放在 bot 包', 'recall 走文本输出不发卡片'],
    todos: [
      { text: '实现 CardBuilder', assignee: 'Antares', due: '2026-05-06' },
      { text: '接入 WSClient', assignee: 'Evan', due: '2026-05-06' },
    ],
    followUps: ['确认飞书 API 权限', '补充单元测试'],
  }).content);
  await sleep(800);

  await send('6/10 slides — 演示文稿', larkCardBuilder.build('slides', {
    title: '业务探索方向汇报',
    presentationUrl: 'https://example.feishu.cn/slides/demo',
    pageCount: 4,
    preview: [
      { title: '背景与机会', bullets: ['市场空间分析', '竞品对比'] },
      { title: '我们的方案', bullets: ['Lark Loom Agent', '核心：主动感知'] },
      { title: '技术实现', bullets: ['飞书 Card 2.0', '7 条 Skill 主线'] },
      { title: '下一步', bullets: ['MVP 上线', '用户反馈'] },
    ],
  }).content);
  await sleep(800);

  await send('7/10 archive — 项目归档', larkCardBuilder.build('archive', {
    recordId: 'rec_20260514',
    title: '业务探索项目 · 最终归档',
    bitableUrl: 'https://example.feishu.cn/bitable/archive',
    tags: ['2026-Q2', '飞书挑战赛', '已完成'],
    summary: '完成了需求验证与 MVP 演示，获评委认可。',
  }).content);
  await sleep(800);

  await send('8/10 offlineSummary — 离线摘要', larkCardBuilder.build('offlineSummary', {
    offlineFrom: Date.now() - 7200000,
    offlineTo: Date.now(),
    highlights: [
      'Evan 完成了 WSClient 长连接接入',
      '沛彤更新了需求文档（修改了验收标准）',
      '团队确定了复赛演示顺序',
    ],
    messageCount: 57,
  }).content);
  await sleep(800);

  await send('9/10 docChange — 文档变更通知', larkCardBuilder.build('docChange', {
    editorName: '沛彤',
    docTitle: '业务探索需求文档',
    docUrl: 'https://example.feishu.cn/docs/req',
    changeSummary: '修改了验收标准，新增了两个边界场景描述。',
    affectedTasks: ['CardBuilder 实现', 'Skill Router 设计'],
  }).content);
  await sleep(800);

  await send('10/10 weekly — 周报', larkCardBuilder.build('weekly', {
    weekRange: '2026-04-29 ~ 2026-05-05',
    highlights: ['CardBuilder 10 种模板全部实现', '单元测试 19 个全绿'],
    decisions: ['recall 走文本不走卡片', '复赛演示聚焦主链路'],
    todos: ['WSClient 接入', 'Skill Router 实现', '演示 demo 准备'],
    metrics: { 'PR 合并数': 3, '测试覆盖率(%)': 95 },
  }).content);

  console.log(`\n${'─'.repeat(50)}\n✅ 全部发送完毕，截图后贴到 PR #18。`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
