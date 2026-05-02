/**
 * 🅱 recall — 主动浮信息（核心差异化）🔥
 *
 * 触发：群消息中出现 "上次 / 之前 / 我记得 / 那个数据 / 上回..."
 * 数据流：缺口检测（小模型）→ 命中 → Skill Router 选数据源 → 并行检索 → 召回卡片
 *
 * 这是 Lark Loom 的灵魂 Skill；做好了是神，做差了就是骚扰机器人。
 */

import type { Skill } from '@seedhac/contracts';
import { ErrorCode, err, makeError } from '@seedhac/contracts';

export const recallSkill: Skill = {
  name: 'recall',
  trigger: {
    events: ['message'],
    requireMention: false,
    keywords: ['上次', '之前', '我记得', '那个', '上回', '是多少来着'],
    description: '群消息出现模糊表述 → 主动召回历史信息（事中介入）',
  },
  match: () => false, // TODO: 缺口检测（豆包 Lite）
  run: async () => err(makeError(ErrorCode.SKILL_NOT_IMPLEMENTED, 'recall skill not implemented')),
};
