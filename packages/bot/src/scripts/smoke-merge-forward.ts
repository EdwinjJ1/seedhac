/**
 * 直接跑 fetchHistory + fetchMessage 的真实链路，看 merge_forward 究竟落成啥 contentType。
 * 用法: pnpm --filter @seedhac/bot exec node --env-file=../../.env --import tsx/esm src/scripts/smoke-merge-forward.ts
 */

import { createBotRuntime } from '../bot-runtime.js';

// 接收任意 chatId：node ... smoke-merge-forward.ts <chat_id>
const TARGET_CHAT = process.argv[2];
if (!TARGET_CHAT) {
  console.error('Usage: smoke-merge-forward.ts <chat_id>');
  process.exit(1);
}

async function main(): Promise<void> {
  const runtime = createBotRuntime();
  console.log(`=== fetchHistory(chatId=${TARGET_CHAT}) 实际返回 ===`);
  const histResult = await runtime.fetchHistory({ chatId: TARGET_CHAT, pageSize: 10 });
  if (!histResult.ok) {
    console.error('fetchHistory failed:', histResult.error);
    process.exit(1);
  }
  for (const m of histResult.value.messages) {
    console.log(
      `  mid=${m.messageId.slice(-12)} contentType=${JSON.stringify(m.contentType)} text=${JSON.stringify(m.text.slice(0, 30))} rawHead=${JSON.stringify((m.rawContent ?? '').slice(0, 40))}`,
    );
  }

  // 找出第一条 merge_forward 直接 fetchMessage 看嵌套子结构
  const mf = histResult.value.messages.find((m) => (m.contentType as string) === 'merge_forward');
  if (!mf) {
    console.log('\n(no merge_forward in history) — 这就是 expandMergeForward 没触发的根因');
    process.exit(0);
  }

  console.log(`\n=== fetchMessage(${mf.messageId}) 嵌套子展开 ===`);
  const expanded = await runtime.fetchMessage(mf.messageId);
  if (!expanded.ok) {
    console.error('fetchMessage failed:', expanded.error);
    process.exit(1);
  }
  for (const c of expanded.value.messages) {
    console.log(
      `  mid=${c.messageId.slice(-12)} contentType=${JSON.stringify(c.contentType)} text=${JSON.stringify(c.text.slice(0, 60))}`,
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
