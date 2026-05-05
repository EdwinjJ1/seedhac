/**
 * archive — 项目全链路归档
 *
 * 触发：群里出现"复盘 / 归档 / 项目结束 / 收尾"（被动监听，无需 @bot）
 * 数据流：并行拉 Bitable 全量数据 → LLM 生成归档摘要 → archive 卡片
 *
 * 注意：docx 创建依赖 #32 DocxClient，尚未 merge，当前跳过该步骤。
 */

import {
  type Skill,
  type SkillContext,
  type SkillResult,
  type Result,
  ok,
  err,
  ErrorCode,
  makeError,
} from '@seedhac/contracts';
import { ARCHIVE_PROMPT } from './prompts/archive.js';

const TRIGGER_RE = /复盘|归档|项目结束|收尾/i;

export const archiveSkill: Skill = {
  name: 'archive',
  metadata: {
    description: '在项目收尾时汇总记忆、决策和任务，生成归档卡片。',
    when_to_use: '群里出现复盘、归档、项目结束、收尾等信号，需要整理项目成果时使用。',
    examples: ['项目结束了，归档一下', '我们做个复盘', '@bot 汇总本项目成果'],
  },
  trigger: {
    events: ['message'],
    requireMention: false,
    keywords: ['复盘', '归档', '项目结束', '收尾'],
    description: '检测到项目结束信号时打包归档所有成果',
  },

  match(ctx: SkillContext): boolean {
    if (ctx.event.type !== 'message') return false;
    return TRIGGER_RE.test(ctx.event.payload.text);
  },

  async run(ctx: SkillContext): Promise<Result<SkillResult>> {
    if (ctx.event.type !== 'message') {
      return err(makeError(ErrorCode.INVALID_INPUT, 'archive only handles message events'));
    }
    const { chatId } = ctx.event.payload;

    const filter = `AND(CurrentValue.[chatId]="${chatId}")`;

    // 并行拉三张表
    const [memoryRes, decisionRes, todoRes] = await Promise.all([
      ctx.bitable.find({ table: 'memory', filter, pageSize: 100 }),
      ctx.bitable.find({ table: 'decision', filter, pageSize: 100 }),
      ctx.bitable.find({ table: 'todo', filter, pageSize: 100 }),
    ]);

    const memories = memoryRes.ok ? memoryRes.value.records : [];
    const decisions = decisionRes.ok ? decisionRes.value.records : [];
    const todos = todoRes.ok ? todoRes.value.records : [];

    // LLM 生成摘要
    const llmResult = await ctx.llm.ask(ARCHIVE_PROMPT(memories, decisions, todos), {
      model: 'pro',
    });
    if (!llmResult.ok) return err(llmResult.error);

    const summaryText = llmResult.value.trim();
    const recordId = `archive_${chatId}_${Date.now()}`;

    const card = ctx.cardBuilder.build('archive', {
      recordId,
      title: '项目归档',
      bitableUrl: '',
      tags: [],
      summary: summaryText,
    });

    return ok({
      card,
      reasoning: `归档 ${decisions.length} 条决策，${todos.length} 条任务`,
    });
  },
};
