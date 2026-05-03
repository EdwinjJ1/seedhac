/**
 * 🅶 weekly — 定时周报
 *
 * 触发：cron 周五 17:00（不监听消息事件，由 runtime scheduler 推 BotEvent）
 * 数据流：扫本周群消息 → LLM 抽 highlights / 决策 / 待办 → weekly 卡片
 */

import type { Skill } from '@seedhac/contracts';
import { ErrorCode, err, makeError } from '@seedhac/contracts';

export const weeklySkill: Skill = {
  name: 'weekly',
  trigger: {
    events: [], // 不监听消息事件，由 runtime scheduler 按 cron 推 BotEvent
    requireMention: false,
    cron: '0 17 * * 5',
    description: '周五 17:00 → 扫本周消息生成周报卡片',
  },
  match: () => false,
  run: async () => err(makeError(ErrorCode.SKILL_NOT_IMPLEMENTED, 'weekly skill not implemented')),
};
