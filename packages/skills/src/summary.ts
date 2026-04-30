/**
 * 🅲 summary — 会议纪要
 *
 * 触发：@bot 整理 / @bot 纪要 / @bot 总结
 * 数据流：拉群历史（默认最近 N 条或时间窗）→ LLM 抽取 → summary 卡片
 * 输出：议题 / 决议 / 待办 / 待跟进 4 段
 */

import type { Skill } from '@seedhac/contracts';
import { ErrorCode, err, makeError } from '@seedhac/contracts';

export const summarySkill: Skill = {
  name: 'summary',
  trigger: {
    events: ['message'],
    requireMention: true,
    keywords: ['整理', '纪要', '总结'],
    description: '@bot 整理 → 拉群历史出 4 段纪要',
  },
  match: () => false,
  run: async () => err(makeError(ErrorCode.SKILL_NOT_IMPLEMENTED, 'summary skill not implemented')),
};
