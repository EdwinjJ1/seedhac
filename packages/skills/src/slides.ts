/**
 * 🅳 slides — 幻灯片生成
 *
 * 触发：被动监听，群里出现 PPT/演示/汇报相关讨论后自动生成
 * 数据流：群聊上下文 + Bitable 快照 → LLM 生成大纲 → 飞书文档（markdown）→ slides 卡片
 */

import type { Message, Skill } from '@seedhac/contracts';
import { err, ok } from '@seedhac/contracts';
import { OutlineSchema, SLIDES_PROMPT } from './prompts/slides.js';

export const slidesSkill: Skill = {
  name: 'slides',
  trigger: {
    events: ['message'],
    requireMention: false,
    keywords: ['ppt', 'PPT', '幻灯片', '演示文稿', '汇报', '演示'],
    description: '检测到 PPT/演示需求时自动生成演示文稿',
  },
  match: (ctx) => {
    if (ctx.event.type !== 'message') return false;
    const text = (ctx.event.payload as Message).text;
    return /ppt|幻灯片|演示文稿|向上级汇报|给老板汇报|做个演示|做.{0,10}汇报/i.test(text);
  },
  run: async (ctx) => {
    const msg = ctx.event.payload as Message;
    const chatId = msg.chatId;

    // a. 拉取群历史消息
    const historyResult = await ctx.runtime.fetchHistory({ chatId, pageSize: 30 });
    if (!historyResult.ok) return err(historyResult.error);
    const history = historyResult.value.messages;

    // b. 查 Bitable 项目快照
    const snapshotResult = await ctx.bitable.find({
      table: 'memory',
      where: { chatId },
      pageSize: 3,
    });
    const snapshots = snapshotResult.ok ? snapshotResult.value.records : [];

    // c. LLM 生成大纲
    const outlineResult = await ctx.llm.askStructured(
      SLIDES_PROMPT(history, snapshots),
      OutlineSchema,
      { model: 'pro' },
    );
    if (!outlineResult.ok) return err(outlineResult.error);
    const outline = outlineResult.value;

    // d. 序列化为 markdown
    const markdown =
      `# ${outline.title}\n\n` +
      outline.slides
        .map((s) => `## ${s.heading}\n${s.bullets.map((b) => `- ${b}`).join('\n')}`)
        .join('\n\n');

    // e. 创建飞书文档
    const docResult = await ctx.docx.createFromMarkdown(outline.title, markdown);
    if (!docResult.ok) return err(docResult.error);

    // f. 构建 slides 卡片
    const card = ctx.cardBuilder.build('slides', {
      title: outline.title,
      presentationUrl: docResult.value.url,
      pageCount: outline.slides.length,
      preview: outline.slides.slice(0, 2).map((s) => ({
        title: s.heading,
        bullets: s.bullets,
      })),
    });

    return ok({
      card,
      reasoning: `检测到 PPT 需求，基于 ${history.length} 条群聊记录生成 ${outline.slides.length} 页大纲`,
    });
  },
};
