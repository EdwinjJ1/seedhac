/**
 * 🅴 archive — 复盘归档
 *
 * 触发：@bot 复盘 / @bot 归档
 * 数据流：拉群历史 → LLM 抽取决策 / 数据 / 待办 → 写 Bitable
 *         （含双向关联字段，作为知识图谱节点）
 */

import type { Skill } from '@seedhac/contracts';
import { ErrorCode, err, makeError } from '@seedhac/contracts';

export const archiveSkill: Skill = {
  name: 'archive',
  trigger: {
    events: ['message'],
    requireMention: true,
    keywords: ['复盘', '归档'],
    description: '@bot 复盘 → 抽取决策/数据/待办 → 写 Bitable + 知识图谱',
  },
  match: () => false,
  run: async () => err(makeError(ErrorCode.SKILL_NOT_IMPLEMENTED, 'archive skill not implemented')),
};
