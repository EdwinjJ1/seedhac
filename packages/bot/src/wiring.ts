import type { ChatMessage, Skill, SkillContext, SkillName } from '@seedhac/contracts';
import type { Message } from '@seedhac/contracts';
import type { RouteIntent } from './skill-router.js';
import type { SkillRouter } from './skill-router.js';
import type { MemoryStore } from './memory/memory-store.js';
import { getLLMTools, makeExecutor } from './memory/tool-handlers.js';
import type { SystemPromptCache } from './memory/system-prompt.js';

export const intentToSkill: Partial<Record<RouteIntent, SkillName>> = {
  qa: 'qa',
  meetingNotes: 'summary',
  slides: 'slides',
};

export interface HarnessConfig {
  readonly promptCache: SystemPromptCache;
  readonly memoryStore: MemoryStore;
  readonly docsRoot: string;
}

export async function handleEvent(
  ctx: SkillContext,
  router: SkillRouter,
  skills: Readonly<Partial<Record<SkillName, Skill>>>,
  harness?: HarnessConfig,
): Promise<void> {
  const { event, logger, runtime } = ctx;
  if (event.type === 'cardAction') {
    await handleCardAction(ctx, skills);
    return;
  }
  if (event.type !== 'message') return;

  const msg = event.payload;
  const isMention = msg.mentions.length > 0;

  // @mention 消息走 Harness：chatWithTools 让模型按需调 memory/skill 工具
  if (harness && isMention) {
    await handleWithHarness(ctx, msg, harness);
    return;
  }

  // 非 @mention：保持原有 Skill 路由
  const intent = router.route(msg);
  const skillName = intentToSkill[intent];
  if (!skillName) return;
  const skill = skills[skillName];
  if (!skill) return;
  if (!(await skill.match(ctx))) return;
  const result = await skill.run(ctx);
  if (!result.ok) {
    logger.error('skill failed', { code: result.error.code, message: result.error.message });
    return;
  }
  const { card, text } = result.value;
  if (card) {
    const sendResult = await runtime.sendCard({ chatId: msg.chatId, card });
    if (!sendResult.ok) {
      logger.error('send card failed', {
        code: sendResult.error.code,
        message: sendResult.error.message,
      });
      return;
    }
  }
  if (text) {
    const sendResult = await runtime.sendText({ chatId: msg.chatId, text });
    if (!sendResult.ok) {
      logger.error('send text failed', {
        code: sendResult.error.code,
        message: sendResult.error.message,
      });
      return;
    }
  }
  logger.info(`skill=${skillName} replied to chat=${msg.chatId}`);
}

async function handleWithHarness(
  ctx: SkillContext,
  msg: Message,
  harness: HarnessConfig,
): Promise<void> {
  const { llm, runtime, logger } = ctx;
  const chatId = msg.chatId;

  const systemPrompt = harness.promptCache.build({ chatId, mention: true });
  const executor = makeExecutor({
    store: harness.memoryStore,
    chatId,
    logger,
    docsRoot: harness.docsRoot,
  });

  const messages: ChatMessage[] = [{ role: 'user', content: msg.text }];

  const result = await llm.chatWithTools(messages, {
    systemPrompt,
    tools: getLLMTools(),
    executor,
    maxToolCallRounds: 5,
  });

  if (!result.ok) {
    logger.error('harness chatWithTools failed', {
      code: result.error.code,
      message: result.error.message,
    });
    await runtime.sendText({ chatId, text: '抱歉，处理请求时出错了，请稍后再试。' });
    return;
  }

  const { content, rounds, toolCalls } = result.value;
  logger.info('harness replied', { chatId, rounds, toolCallCount: toolCalls.length });

  if (content) {
    const sendResult = await runtime.sendText({ chatId, text: content });
    if (!sendResult.ok) {
      logger.error('harness send text failed', {
        code: sendResult.error.code,
        message: sendResult.error.message,
      });
    }
  }
}

async function handleCardAction(
  ctx: SkillContext,
  skills: Readonly<Partial<Record<SkillName, Skill>>>,
): Promise<void> {
  const { event, logger, runtime } = ctx;
  if (event.type !== 'cardAction') return;
  const action = event.payload.value['action'];
  if (action !== 'qa.reanswer') return;

  const chatId = String(event.payload.value['chatId'] ?? event.payload.chatId);
  const questionMessageId = String(event.payload.value['questionMessageId'] ?? '');
  if (!chatId || !questionMessageId) {
    logger.warn('qa.reanswer missing chatId or questionMessageId', { chatId, questionMessageId });
    return;
  }

  const qa = skills.qa;
  if (!qa) return;

  const historyResult = await runtime.fetchHistory({ chatId, pageSize: 50 });
  if (!historyResult.ok) {
    logger.error('qa.reanswer history fetch failed', {
      code: historyResult.error.code,
      message: historyResult.error.message,
    });
    return;
  }

  const question = historyResult.value.messages.find((m) => m.messageId === questionMessageId);
  if (!question) {
    await runtime.sendText({ chatId, text: '找不到原问题了，可以重新 @ 我问一次。' });
    return;
  }

  const replayCtx: SkillContext = {
    ...ctx,
    event: { type: 'message', payload: question as Message },
  };
  const result = await qa.run(replayCtx);
  if (!result.ok) {
    logger.error('qa.reanswer skill failed', {
      code: result.error.code,
      message: result.error.message,
    });
    return;
  }

  const { card, text } = result.value;
  if (card) await runtime.sendCard({ chatId, card });
  if (text) await runtime.sendText({ chatId, text });
  logger.info(`skill=qa reanswered chat=${chatId}`);
}
