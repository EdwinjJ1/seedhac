/**
 * Smoke 测试 GapDetector — 跑几个真实场景看反应
 *
 * 跑法：pnpm --filter @seedhac/bot exec node --env-file=../../.env --import tsx/esm src/scripts/smoke-gap-detector.ts
 */

import { GapDetector } from '../gap-detector.js';
import { createLLMClient } from '../llm-client.js';
import type { Message } from '@seedhac/contracts';

let counter = 0;
function msg(name: string, text: string): Message {
  counter += 1;
  return {
    messageId: `m${counter}`,
    chatId: 'smoke',
    chatType: 'group',
    sender: { userId: `u_${name}`, name },
    contentType: 'text',
    text,
    rawContent: text,
    mentions: [],
    timestamp: Date.now() + counter,
  };
}

interface Scenario {
  name: string;
  messages: Message[];
  expectTrigger: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    name: '🔥 你给的例子: 上次小李方案做的咋样了',
    messages: [msg('Edwin', '上次小李方案做的咋样了')],
    expectTrigger: true,
  },
  {
    name: '🔥 你给的例子: 上次的咋样了',
    messages: [msg('Edwin', '上次的咋样了')],
    expectTrigger: true,
  },
  {
    name: '决赛 demo 场景: 上次那个用户调研',
    messages: [
      msg('PM1', '上次那个用户调研，转化率好像挺低的？'),
      msg('PM2', '对啊，我记得是个位数'),
    ],
    expectTrigger: true,
  },
  {
    name: '决赛 demo 场景: 那个客户叫啥来着',
    messages: [
      msg('A', '上次那个签合同的客户叫什么来着'),
      msg('B', '想不起来了'),
    ],
    expectTrigger: true,
  },
  {
    name: '负样本: 中午吃啥',
    messages: [msg('A', '中午吃啥'), msg('B', '随便')],
    expectTrigger: false,
  },
  {
    name: '负样本: 今天天气不错',
    messages: [msg('A', '今天天气不错')],
    expectTrigger: false,
  },
  {
    name: '负样本: 当前对话已答',
    messages: [msg('A', 'Q3 转化率多少'), msg('B', '7.2%，刚拉的报表')],
    expectTrigger: false,
  },
  {
    name: '边缘: 疑问无人答',
    messages: [
      msg('PM', '我们的 DAU 现在多少'),
      msg('Eng1', '在跑测试'),
      msg('Eng2', '我也准备下班了'),
    ],
    expectTrigger: true,
  },
];

function fmt(messages: Message[]): string {
  return messages.map((m) => `  [${m.sender.name}] ${m.text}`).join('\n');
}

async function main() {
  const llm = createLLMClient();
  const detector = new GapDetector(llm);

  console.info('═══════════════════════════════════════════════════════');
  console.info(' GapDetector 实测');
  console.info('═══════════════════════════════════════════════════════\n');

  let pass = 0;
  let fail = 0;

  for (const sc of SCENARIOS) {
    console.info(`▸ ${sc.name}`);
    console.info(fmt(sc.messages));

    const start = Date.now();
    const r = await detector.detect(sc.messages);
    const ms = Date.now() - start;

    if (!r.ok) {
      console.error(`  ❌ ERROR ${r.error.code}: ${r.error.message}\n`);
      fail += 1;
      continue;
    }

    const v = r.value;
    const correct = v.shouldRecall === sc.expectTrigger;
    const mark = correct ? '✅' : '❌';
    if (correct) pass += 1;
    else fail += 1;

    console.info(`  ${mark} shouldRecall=${v.shouldRecall} source=${v.source} (${ms}ms)`);
    if (v.shouldRecall) {
      console.info(`     query="${v.query}"  reason="${v.reason}"`);
    }
    console.info('');
  }

  console.info('═══════════════════════════════════════════════════════');
  console.info(` ${pass}/${pass + fail} 通过`);
  console.info('═══════════════════════════════════════════════════════');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
