/**
 * GapDetector 评估集 — 验证 prompt 在真实豆包 Lite 上的准确率。
 *
 * 默认跳过；只在配置了 ARK_API_KEY + ARK_MODEL_LITE + ARK_MODEL_PRO 时运行。
 *
 * 跑法（推荐 pnpm script，自动加载 .env）：
 *   pnpm --filter @seedhac/bot eval:gap-detector
 *
 * 验收：
 *   - 正样本召回率 ≥ 80%
 *   - 负样本误报率 ≤ 20%
 *   - 总准确率 ≥ 80%
 */

import { describe, it, expect } from 'vitest';
import { GapDetector } from '../gap-detector.js';
import { createLLMClient } from '../llm-client.js';
import type { Message } from '@seedhac/contracts';

const HAS_ARK = Boolean(
  process.env['ARK_API_KEY'] &&
    process.env['ARK_MODEL_LITE'] &&
    process.env['ARK_MODEL_PRO'],
);

interface Sample {
  readonly label: 'positive' | 'negative';
  readonly tag: string;
  readonly messages: readonly { sender: string; text: string }[];
}

const SAMPLES: readonly Sample[] = [
  // ─── 正样本：应触发 ──────────────────────────────────────
  {
    label: 'positive',
    tag: '不确定性-Q3 数据',
    messages: [
      { sender: 'PM1', text: '上次那个用户调研，转化率好像挺低的？' },
      { sender: 'PM2', text: '对啊，我记得是个位数' },
    ],
  },
  {
    label: 'positive',
    tag: '不确定性-那个客户',
    messages: [
      { sender: 'A', text: '上次那个签合同的客户叫什么来着' },
      { sender: 'B', text: '想不起来了' },
    ],
  },
  {
    label: 'positive',
    tag: '不确定性-上次会议',
    messages: [
      { sender: 'A', text: '上次会议是不是定了发布日期' },
      { sender: 'B', text: '好像是？' },
    ],
  },
  {
    label: 'positive',
    tag: '不确定性-那个文档',
    messages: [
      { sender: 'A', text: '那个 PRD 改完了吗' },
      { sender: 'B', text: '应该改了，找不到链接' },
    ],
  },
  {
    label: 'positive',
    tag: '疑问无人答',
    messages: [
      { sender: 'PM', text: '我们的 DAU 现在多少' },
      { sender: 'Eng1', text: '在跑测试' },
      { sender: 'Eng2', text: '我也准备下班了' },
    ],
  },
  {
    label: 'positive',
    tag: '任务型-决策待查',
    messages: [
      { sender: 'A', text: '当时我们决定用 PostgreSQL 还是 MySQL 来着' },
      { sender: 'B', text: '我忘了' },
    ],
  },
  {
    label: 'positive',
    tag: '不确定性-数据',
    messages: [
      { sender: 'A', text: 'Q3 同期增长是多少来着' },
    ],
  },
  {
    label: 'positive',
    tag: '不确定性-之前讨论',
    messages: [
      { sender: 'A', text: '我记得之前讨论过这个边界条件' },
      { sender: 'B', text: '在哪聊的来着' },
    ],
  },
  {
    label: 'positive',
    tag: '历史关联-竞品',
    messages: [
      { sender: 'A', text: '同类竞品的转化率好像是 12 还是 15' },
    ],
  },
  {
    label: 'positive',
    tag: '不确定性-合同条款',
    messages: [
      { sender: 'A', text: '合同里那个赔偿条款是按月还是按天来着' },
    ],
  },

  // ─── 负样本：不应触发 ────────────────────────────────────
  {
    label: 'negative',
    tag: '日常-吃饭',
    messages: [
      { sender: 'A', text: '中午吃啥' },
      { sender: 'B', text: '随便' },
    ],
  },
  {
    label: 'negative',
    tag: '日常-天气',
    messages: [{ sender: 'A', text: '今天天气不错' }],
  },
  {
    label: 'negative',
    tag: '日常-玩笑',
    messages: [
      { sender: 'A', text: '你这条 PR 写得真行' },
      { sender: 'B', text: '哈哈嘲讽我' },
    ],
  },
  {
    label: 'negative',
    tag: '简单确认',
    messages: [
      { sender: 'A', text: '收到' },
      { sender: 'B', text: 'ok' },
    ],
  },
  {
    label: 'negative',
    tag: '当前对话已答',
    messages: [
      { sender: 'A', text: 'Q3 转化率多少' },
      { sender: 'B', text: '7.2%，刚拉的报表' },
    ],
  },
  {
    label: 'negative',
    tag: '日常-请假',
    messages: [{ sender: 'A', text: '我下午有事先走了' }],
  },
  {
    label: 'negative',
    tag: '日常-加班',
    messages: [
      { sender: 'A', text: '今晚加班吗' },
      { sender: 'B', text: '不用' },
    ],
  },
  {
    label: 'negative',
    tag: '正在工作汇报',
    messages: [
      { sender: 'A', text: '我刚把登录页改完了，提了 PR' },
    ],
  },
  {
    label: 'negative',
    tag: '日常-表情',
    messages: [{ sender: 'A', text: '哈哈哈哈哈' }],
  },
  {
    label: 'negative',
    tag: '当前对话已答-2',
    messages: [
      { sender: 'A', text: '上次那个客户叫啥' },
      { sender: 'B', text: '叫张总，开过两次会' },
    ],
  },
];

let counter = 0;
function toMessage(s: { sender: string; text: string }): Message {
  counter += 1;
  return {
    messageId: `eval_${counter}`,
    chatId: 'eval_chat',
    chatType: 'group',
    sender: { userId: `u_${s.sender}`, name: s.sender },
    contentType: 'text',
    text: s.text,
    rawContent: s.text,
    mentions: [],
    timestamp: 1_700_000_000_000 + counter,
  };
}

describe.skipIf(!HAS_ARK)('GapDetector evaluation (live豆包 Lite)', () => {
  it('runs accuracy check on 20 samples', async () => {
    const llm = createLLMClient();
    const detector = new GapDetector(llm);

    // 并发跑 20 条，节省总时长（豆包 Lite 单次 5-12s 串行会超时）
    const results = await Promise.all(
      SAMPLES.map(async (sample) => {
        const messages = sample.messages.map(toMessage);
        const r = await detector.detect(messages);
        const got = r.ok && r.value.shouldRecall;
        return {
          tag: sample.tag,
          expected: sample.label === 'positive',
          got,
        };
      }),
    );

    const tp = results.filter((r) => r.expected && r.got).length;
    const fn = results.filter((r) => r.expected && !r.got).length;
    const fp = results.filter((r) => !r.expected && r.got).length;
    const tn = results.filter((r) => !r.expected && !r.got).length;

    const recall = tp / (tp + fn);
    const fpr = fp / (fp + tn);
    const acc = (tp + tn) / results.length;

    console.info('\nEval results:');
    console.info(`  positives: ${tp}/${tp + fn} recalled (recall=${recall.toFixed(2)})`);
    console.info(`  negatives: ${fp}/${fp + tn} false-fired (fpr=${fpr.toFixed(2)})`);
    console.info(`  accuracy:  ${acc.toFixed(2)}`);
    console.info('  failures:');
    for (const r of results.filter((x) => x.expected !== x.got)) {
      console.info(`    [${r.expected ? 'POS→missed' : 'NEG→false-fire'}] ${r.tag}`);
    }

    expect(recall).toBeGreaterThanOrEqual(0.8);
    expect(fpr).toBeLessThanOrEqual(0.2);
    expect(acc).toBeGreaterThanOrEqual(0.8);
  }, 300_000);
});
