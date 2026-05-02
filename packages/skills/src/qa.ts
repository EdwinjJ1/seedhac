/**
 * 🅰 qa — 被动问答
 *
 * 触发：@bot + 疑问句（"...?" / "...吗" / "...呢"）
 * 数据流：群历史检索 / Wiki / Bitable → LLM 整合 → qa 卡片
 */

import type { Message, Skill } from '@seedhac/contracts';
import { ok } from '@seedhac/contracts';

export const qaSkill: Skill = {
  name: 'qa',
  trigger: {
    events: ['message'],
    requireMention: true,
    keywords: ['?', '？', '吗', '呢'],
    description: '@bot + 疑问句 → 检索群历史回答',
  },
  match: (ctx) => {
    const msg = ctx.event.payload as Message;
    return msg.mentions.some((m) => m.user.userId === process.env['LARK_BOT_OPEN_ID']);
  },
  run: async (ctx) => {
    const msg = ctx.event.payload as Message;
    return ok({
      text: `（Mock）收到问题：「${msg.text}」\n真实回答逻辑待 #NEW-4 实现。`,
    });
  },
};
