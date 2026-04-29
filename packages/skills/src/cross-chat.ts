/**
 * 🅵 crossChat — 跨群联动
 *
 * 触发：@bot + "之前在 X 群 / 那个项目群说过..."
 * 数据流：Chroma 向量检索（多 chatId 范围）→ LLM 整合 → crossChat 卡片
 *
 * 注意：跨群检索仅限 bot 已加入的群，不能越权。
 */

import type { Skill } from '@seedhac/contracts';
import { ErrorCode, err, makeError } from '@seedhac/contracts';

export const crossChatSkill: Skill = {
  name: 'crossChat',
  trigger: {
    events: ['message'],
    requireMention: true,
    keywords: ['之前在', '那个群'],
    description: '@bot + 跨群引用 → 多 chatId 语义搜索',
  },
  match: () => false,
  run: async () =>
    err(makeError(ErrorCode.SKILL_NOT_IMPLEMENTED, 'crossChat skill not implemented')),
};
