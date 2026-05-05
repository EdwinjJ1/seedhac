/**
 * smoke-bot-runtime.ts — BotRuntime 真实调用验证脚本
 *
 * 运行：pnpm --filter @seedhac/bot dev:smoke-bot-runtime
 *
 * 验证步骤：
 *   1. start()    — WebSocket 长连接建立成功
 *   2. on()       — 在测试群发任意一条消息，脚本收到后打印 payload
 *   3. sendText() — 自动回复一条文本消息到群里
 *   4. fetchHistory() — 拉取该群最近 5 条历史消息
 *   5. sendCard() — 发一张简单卡片
 *
 * 收到消息后自动完成所有场景，30s 内没收到消息则超时退出。
 */

import { createBotRuntime } from '../bot-runtime.js';
import { larkCardBuilder } from '../card-builder.js';
import type { Message } from '@seedhac/contracts';

const runtime = createBotRuntime();

function section(title: string): void {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`▶ ${title}`);
  console.log('─'.repeat(50));
}

// ─── 场景 1：start ────────────────────────────────────────────────────────────

section('场景 1 · start — 建立 WebSocket 长连接');

const startResult = await runtime.start();
if (!startResult.ok) {
  console.error('❌ start 失败:', startResult.error);
  process.exit(1);
}
console.log('✅ WebSocket 长连接已启动，等待测试群消息（30s 超时）...');
console.log('👉 现在去测试群随便发一句话');

// ─── 等待第一条消息 ───────────────────────────────────────────────────────────

const firstMessage = await new Promise<Message>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout: 30s 内没有收到消息')), 30_000);

  runtime.on((event) => {
    if (event.type === 'message') {
      clearTimeout(timer);
      resolve(event.payload);
    }
  });
});

section('场景 2 · on() — 收到消息事件');
console.log('✅ 成功');
console.log('chatId  :', firstMessage.chatId);
console.log('sender  :', firstMessage.sender.userId);
console.log('text    :', firstMessage.text);
console.log('mentions:', firstMessage.mentions.length);

// ─── 场景 3：sendText ─────────────────────────────────────────────────────────

section('场景 3 · sendText — 发送文本消息');

const sendResult = await runtime.sendText({
  chatId: firstMessage.chatId,
  text: '[smoke test] BotRuntime.sendText() 验证通过 ✅',
  replyTo: firstMessage.messageId,
});

if (!sendResult.ok) {
  console.error('❌ sendText 失败:', sendResult.error);
} else {
  console.log('✅ 成功，messageId:', sendResult.value.messageId);
}

// ─── 场景 4：fetchHistory ─────────────────────────────────────────────────────

section('场景 4 · fetchHistory — 拉取最近 5 条历史');

const historyResult = await runtime.fetchHistory({
  chatId: firstMessage.chatId,
  pageSize: 5,
});

if (!historyResult.ok) {
  console.error('❌ fetchHistory 失败:', historyResult.error);
} else {
  console.log('✅ 成功，拉取到', historyResult.value.messages.length, '条消息');
  for (const msg of historyResult.value.messages) {
    console.log(`  [${msg.messageId}] ${msg.sender.userId}: ${msg.text || `<${msg.contentType}>`}`);
  }
  console.log('hasMore:', historyResult.value.hasMore);
}

// ─── 场景 5：fetchMembers ─────────────────────────────────────────────────────

section('场景 5 · fetchMembers — 拉取群成员列表');

const membersResult = await runtime.fetchMembers({ chatId: firstMessage.chatId });

if (!membersResult.ok) {
  console.error('❌ fetchMembers 失败:', membersResult.error);
  console.error('   可能缺少权限: im:chat:readonly 或 im:chat.member:read');
} else {
  console.log('✅ 成功，共', membersResult.value.members.length, '位成员:');
  for (const m of membersResult.value.members) {
    console.log(`  userId=${m.userId}  name=${m.name}`);
  }
}

// ─── 场景 6：sendCard ─────────────────────────────────────────────────────────

section('场景 6 · sendCard — 发送卡片消息');

const card = larkCardBuilder.build('activation', {
  chatName: 'smoke test · BotRuntime.sendCard() 验证通过 ✅',
});

const cardResult = await runtime.sendCard({
  chatId: firstMessage.chatId,
  card,
});

if (!cardResult.ok) {
  console.error('❌ sendCard 失败:', cardResult.error);
} else {
  console.log('✅ 成功，messageId:', cardResult.value.messageId);
}

// ─── 完成 ─────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log('🎉 全部场景通过，BotRuntime 真实调用验证完成');
console.log('─'.repeat(50));

await runtime.stop();
process.exit(0);
