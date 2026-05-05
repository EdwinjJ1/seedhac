/**
 * requirementDoc — 需求文档自动生成
 *
 * 触发：被动监听，群里出现项目需求描述时自动整理成结构化飞书文档
 * 数据流：群历史消息 → LLM 结构化提取 → 创建飞书文档 → 推 docPush 卡片 → 存入 memory
 */

import type { Skill } from '@seedhac/contracts';
import { ErrorCode, err, makeError } from '@seedhac/contracts';

export const requirementDocSkill: Skill = {
  name: 'requirementDoc',
  metadata: {
    description: '把项目需求描述整理为结构化需求文档。',
    when_to_use: '群里出现项目背景、PRD、功能需求、产品需求，且需要沉淀成文档时使用。',
    examples: ['这是项目需求，请整理', '我们要写 PRD', '@bot 根据这段背景生成需求文档'],
  },
  trigger: {
    events: ['message'],
    requireMention: false,
    keywords: ['项目需求', '需求文档', 'PRD', '产品需求', '项目背景'],
    description: '检测到需求描述时自动生成结构化飞书文档',
  },
  match: (ctx) => {
    if (ctx.event.type !== 'message') return false;
    return /项目需求|需求文档|PRD|产品需求|以下是.*需求|这是.*项目|项目背景|项目目标/i.test(
      ctx.event.payload.text,
    );
  },
  run: async () =>
    err(
      makeError(
        ErrorCode.SKILL_NOT_IMPLEMENTED,
        'requirementDoc skill not implemented — see issue #34',
      ),
    ),
};
