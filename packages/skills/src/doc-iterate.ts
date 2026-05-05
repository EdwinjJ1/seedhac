/**
 * docIterate — 核心文档持续迭代
 *
 * 触发：被动监听，对话中出现与已有需求文档相关的新信息时增量更新文档
 * 数据流：查 memory 找已有文档 → 对比新对话内容 → LLM 提取增量 → 追加更新飞书文档
 *
 * 与 requirementDoc 的区别：
 *   - requirementDoc：首次生成，群里从没建过文档时触发
 *   - docIterate：持续迭代，memory 里已有文档时触发，追加而非新建
 */

import type { Skill } from '@seedhac/contracts';
import { ErrorCode, err, makeError } from '@seedhac/contracts';

export const docIterateSkill: Skill = {
  name: 'docIterate',
  metadata: {
    description: '根据新的讨论增量更新已有需求文档。',
    when_to_use: '群里出现需求变更、补充、调整方案等信息，且已有需求文档需要继续迭代时使用。',
    examples: ['需求变更一下', '补充一下登录流程', '@bot 把这个调整写进需求文档'],
  },
  trigger: {
    events: ['message'],
    requireMention: false,
    keywords: ['需求变更', '补充一下', '更新需求', '调整方案'],
    description: '检测到需求变更或补充时增量更新已有需求文档',
  },
  match: (ctx) => {
    if (ctx.event.type !== 'message') return false;
    return /需求变更|补充一下|更新需求|调整方案|新增需求|删掉这个需求/i.test(
      ctx.event.payload.text,
    );
  },
  run: async () =>
    err(
      makeError(
        ErrorCode.SKILL_NOT_IMPLEMENTED,
        'docIterate skill not implemented — see issue #34',
      ),
    ),
};
