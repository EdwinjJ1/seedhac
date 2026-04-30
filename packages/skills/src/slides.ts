/**
 * 🅳 slides — 幻灯片生成
 *
 * 触发：@bot 做 PPT / @bot 生成幻灯片
 * 数据流：群聊上下文 → LLM 出大纲 → 拼飞书 SML 2.0 XML → lark-cli slides +create
 *
 * 飞书云文档"演示文稿"开放 API，bot tenant token 即可调用。
 * 页面 schema：<slide xmlns="http://www.larkoffice.com/sml/2.0"><data>...</data></slide>
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
