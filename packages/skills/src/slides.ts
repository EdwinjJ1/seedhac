/**
 * 🅳 slides — 幻灯片生成
 *
 * 触发：被动监听，群里出现 PPT/演示/汇报相关讨论后自动生成
 * 数据流：群聊上下文 + Bitable 快照 → LLM 生成大纲 → 飞书演示文稿 → slides 卡片
 */

import type { Message, Skill } from '@seedhac/contracts';
import { ErrorCode, err, makeError, ok } from '@seedhac/contracts';
import { OutlineSchema, SLIDES_PROMPT } from './prompts/slides.js';

export const slidesSkill: Skill = {
  name: 'slides',
  metadata: {
    description: '基于群聊上下文和项目记忆生成飞书演示文稿。',
    when_to_use: '用户提到 PPT、幻灯片、演示、汇报，或明确要求生成展示材料时使用。',
    examples: ['帮我做个 PPT', '下周要向老师汇报', '@bot 根据项目进度生成演示稿'],
  },
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

    if (!ctx.slides) {
      return err(makeError(ErrorCode.CONFIG_MISSING, 'slides client is not configured'));
    }

    ctx.logger.info('slides: received request', { chatId, messageId: msg.messageId });
    const ackResult = await ctx.runtime.sendText({
      chatId,
      text: '收到，正在生成演示文稿。这个过程可能需要 30 秒左右，我生成好后会把卡片发到群里。',
    });
    if (!ackResult.ok) {
      ctx.logger.warn('slides: progress acknowledgement failed', {
        code: ackResult.error.code,
        message: ackResult.error.message,
      });
    }

    // a. 拉取群历史消息
    ctx.logger.info('slides: fetching chat history', { chatId });
    const historyResult = await ctx.runtime.fetchHistory({ chatId, pageSize: 30 });
    if (!historyResult.ok) return err(historyResult.error);
    const history = historyResult.value.messages;

    // b. 查 Bitable 项目快照
    ctx.logger.info('slides: fetching bitable snapshots', { chatId });
    const snapshotResult = await ctx.bitable.find({
      table: 'memory',
      where: { chatId },
      pageSize: 3,
    });
    const snapshots = snapshotResult.ok ? snapshotResult.value.records : [];
    if (!snapshotResult.ok) {
      ctx.logger.warn('slides: bitable snapshots skipped', {
        code: snapshotResult.error.code,
        message: snapshotResult.error.message,
      });
    }

    // c. LLM 生成大纲
    ctx.logger.info('slides: asking LLM for outline', {
      historyCount: history.length,
      snapshotCount: snapshots.length,
    });
    const outlineResult = await ctx.llm.askStructured(
      SLIDES_PROMPT(history, snapshots),
      OutlineSchema,
      { model: 'pro' },
    );
    if (!outlineResult.ok) return err(outlineResult.error);
    const outline = outlineResult.value;

    // d. 创建飞书演示文稿
    ctx.logger.info('slides: creating native presentation', {
      title: outline.title,
      pageCount: outline.slides.length,
    });
    const slidesResult = await ctx.slides.createFromOutline(outline.title, outline);
    if (!slidesResult.ok) return err(slidesResult.error);

    // e. 构建 slides 卡片
    ctx.logger.info('slides: presentation created', { url: slidesResult.value.url });
    const card = ctx.cardBuilder.build('slides', {
      title: outline.title,
      presentationUrl: slidesResult.value.url,
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
