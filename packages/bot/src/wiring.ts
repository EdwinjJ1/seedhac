import type { ChatMessage, LLMClient, Skill, SkillContext, SkillName } from '@seedhac/contracts';
import type { Message } from '@seedhac/contracts';
import type { RouteIntent } from './skill-router.js';
import type { SkillRouter } from './skill-router.js';
import type { IMemoryStore } from './memory/memory-store.js';
import { getLLMTools, makeExecutor } from './memory/tool-handlers.js';
import type { SystemPromptCache } from './memory/system-prompt.js';

export const intentToSkill: Partial<Record<RouteIntent, SkillName>> = {
  qa: 'qa',
  meetingNotes: 'summary',
  slides: 'slides',
};

export interface HarnessConfig {
  readonly promptCache: SystemPromptCache;
  readonly memoryStore: IMemoryStore;
  readonly docsRoot: string;
  /** 机器人自身的 open_id，用于判断消息是否 @bot */
  readonly botOpenId: string;
}

type HarnessDecision = {
  readonly skill: SkillName | 'silent';
  readonly reason?: string;
  readonly args?: Record<string, unknown>;
};

export async function handleEvent(
  ctx: SkillContext,
  router: SkillRouter,
  skills: Readonly<Partial<Record<SkillName, Skill>>>,
  harness?: HarnessConfig,
): Promise<void> {
  const { event, logger } = ctx;
  if (event.type === 'cardAction') {
    await handleCardAction(ctx, skills);
    return;
  }
  if (event.type !== 'message') return;

  const msg = event.payload;
  const isMention = msg.mentions.some((m) => m.user.userId === harness?.botOpenId);

  // @mention 消息走 Harness：chatWithTools 让模型按需调 memory/skill 工具
  if (harness && isMention) {
    const handled = await handleWithHarness(ctx, msg, skills, harness);
    if (handled) return;
    logger.warn('harness fell back to SkillRouter', { chatId: msg.chatId });
    await handleWithSkillRouter(withFallbackSystemPrompt(ctx, harness), router, skills);
    return;
  }

  // 非 @mention：保持原有 Skill 路由
  await handleWithSkillRouter(ctx, router, skills);
}

async function handleWithSkillRouter(
  ctx: SkillContext,
  router: SkillRouter,
  skills: Readonly<Partial<Record<SkillName, Skill>>>,
): Promise<void> {
  const { event } = ctx;
  if (event.type !== 'message') return;
  const msg = event.payload;
  const intent = router.route(msg);
  const skillName = intentToSkill[intent];
  if (!skillName) return;
  const skill = skills[skillName];
  if (!skill) return;
  if (!(await skill.match(ctx))) return;
  await runSkill(ctx, skill);
}

async function runSkill(ctx: SkillContext, skill: Skill): Promise<void> {
  const { event, logger, runtime } = ctx;
  if (event.type !== 'message') return;
  const result = await skill.run(ctx);
  if (!result.ok) {
    logger.error('skill failed', {
      skill: skill.name,
      code: result.error.code,
      message: result.error.message,
    });
    return;
  }
  const { card, text } = result.value;
  if (card) {
    const sendResult = await runtime.sendCard({ chatId: event.payload.chatId, card });
    if (!sendResult.ok) {
      logger.error('send card failed', {
        code: sendResult.error.code,
        message: sendResult.error.message,
      });
      return;
    }
  }
  if (text) {
    const sendResult = await runtime.sendText({ chatId: event.payload.chatId, text });
    if (!sendResult.ok) {
      logger.error('send text failed', {
        code: sendResult.error.code,
        message: sendResult.error.message,
      });
      return;
    }
  }
  logger.info(`skill=${skill.name} replied to chat=${event.payload.chatId}`);
}

async function handleWithHarness(
  ctx: SkillContext,
  msg: Message,
  skills: Readonly<Partial<Record<SkillName, Skill>>>,
  harness: HarnessConfig,
): Promise<boolean> {
  const { llm, logger } = ctx;
  const chatId = msg.chatId;

  const systemPrompt = harness.promptCache.build({ chatId, mention: true });
  const executor = makeExecutor({
    store: harness.memoryStore,
    chatId,
    logger,
    docsRoot: harness.docsRoot,
  });

  const skillChoices = [...registeredSkillNames(skills), 'silent'].join('|');
  const decisionInstruction =
    '请按需调用 skill.list / skill.read / memory.search，然后只输出 JSON：' +
    `{"skill":"${skillChoices}","reason":"一句话原因","args":{}}。` +
    '如果不应处理，skill 必须是 "silent"。不要输出 JSON 以外的文字。';

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${msg.text}\n\n${decisionInstruction}` },
  ];

  const result = await llm.chatWithTools(messages, {
    tools: getLLMTools(),
    executor,
    maxToolCallRounds: 5,
  });

  if (!result.ok) {
    logger.error('harness chatWithTools failed', {
      code: result.error.code,
      message: result.error.message,
    });
    return false;
  }

  const { content, rounds, toolCalls } = result.value;
  logger.info('harness decision returned', { chatId, rounds, toolCallCount: toolCalls.length });

  const decision = parseHarnessDecision(content, skills);
  if (!decision) {
    logger.warn('harness decision parse failed', { chatId, content });
    return false;
  }

  if (decision.skill === 'silent') {
    logger.info('harness selected silent', { chatId, reason: decision.reason });
    return true;
  }

  const skill = skills[decision.skill];
  if (!skill) {
    logger.warn('harness selected missing skill', { chatId, skill: decision.skill });
    return false;
  }

  logger.info('harness selected skill', {
    chatId,
    skill: decision.skill,
    reason: decision.reason,
    args: decision.args ?? {},
  });
  await runSkill(ctx, skill);
  return true;
}

function parseHarnessDecision(
  raw: string,
  skills: Readonly<Partial<Record<SkillName, Skill>>>,
): HarnessDecision | null {
  const trimmed = stripCodeFence(raw);
  try {
    const parsed = JSON.parse(trimmed) as { skill?: unknown; reason?: unknown; args?: unknown };
    if (parsed.skill === 'silent') {
      return {
        skill: 'silent',
        ...(typeof parsed.reason === 'string' && { reason: parsed.reason }),
        ...(isRecord(parsed.args) && { args: parsed.args }),
      };
    }
    if (typeof parsed.skill !== 'string' || !isSkillName(parsed.skill, skills)) return null;
    return {
      skill: parsed.skill,
      ...(typeof parsed.reason === 'string' && { reason: parsed.reason }),
      ...(isRecord(parsed.args) && { args: parsed.args }),
    };
  } catch {
    return null;
  }
}

function stripCodeFence(raw: string): string {
  const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  return match ? match[1]!.trim() : raw.trim();
}

function registeredSkillNames(
  skills: Readonly<Partial<Record<SkillName, Skill>>>,
): readonly SkillName[] {
  return Object.keys(skills).filter((name): name is SkillName => isSkillName(name, skills));
}

function isSkillName(
  value: string,
  skills: Readonly<Partial<Record<SkillName, Skill>>>,
): value is SkillName {
  return Object.prototype.hasOwnProperty.call(skills, value) && Boolean(skills[value as SkillName]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withFallbackSystemPrompt(ctx: SkillContext, harness: HarnessConfig): SkillContext {
  const overview = harness.promptCache.getOverviewText();
  if (!overview) return ctx;
  const llm: LLMClient = {
    ask: (prompt, opts) =>
      ctx.llm.ask(prompt, { ...opts, systemPrompt: opts?.systemPrompt ?? overview }),
    chat: (messages, opts) => {
      if (opts?.systemPrompt) return ctx.llm.chat(messages, opts);
      return ctx.llm.chat([{ role: 'system', content: overview }, ...messages], opts);
    },
    askStructured: (prompt, schema, opts) =>
      ctx.llm.askStructured(prompt, schema, {
        ...opts,
        systemPrompt: opts?.systemPrompt ?? overview,
      }),
    chatWithTools: (messages, opts) => ctx.llm.chatWithTools(messages, opts),
  };
  return { ...ctx, llm };
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
