/**
 * 🅰 qa — 被动问答
 *
 * 触发：@bot + 疑问句（"...?" / "...吗" / "...呢"）
 * 数据流：群历史检索 / Wiki / Bitable → LLM 整合 → qa 卡片
 */

import type { Skill } from '@seedhac/contracts';
import { ErrorCode, err, makeError } from '@seedhac/contracts';

export const qaSkill: Skill = {
  name: 'qa',
  trigger: {
    events: ['message'],
    requireMention: true,
    keywords: ['?', '？', '吗', '呢'],
    description: '@bot + 疑问句 → 检索群历史回答',
  },
  match: () => false, // TODO: 实现关键词 / LLM 判断
  run: async () => err(makeError(ErrorCode.SKILL_NOT_IMPLEMENTED, 'qa skill not implemented')),
};
