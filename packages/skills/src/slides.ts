/**
 * 🅳 slides — 幻灯片生成
 *
 * 触发：@bot 做 PPT / @bot 生成幻灯片
 * 数据流：群聊上下文 → LLM 出大纲 → 飞书 docx-v1 API 创建 markdown 文档 → 用户一键转 PPT
 *
 * 通过 @larksuiteoapi/node-sdk 调用，bot tenant token 即可。
 */

import type { Skill } from '@seedhac/contracts';
import { ErrorCode, err, makeError } from '@seedhac/contracts';

export const slidesSkill: Skill = {
  name: 'slides',
  trigger: {
    events: ['message'],
    requireMention: true,
    keywords: ['做 PPT', '生成幻灯片', 'slides'],
    description: '@bot 做 PPT → 群聊大纲转 SML XML → 飞书原生 PPT',
  },
  match: () => false,
  run: async () => err(makeError(ErrorCode.SKILL_NOT_IMPLEMENTED, 'slides skill not implemented')),
};
