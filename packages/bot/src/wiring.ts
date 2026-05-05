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
  if (event.type === 'schedule') {
    await handleSchedule(ctx, skills);
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
  const result = await skill.run(ctx);
  if (!result.ok) {
    logger.error('skill failed', {
      skill: skill.name,
      code: result.error.code,
      message: result.error.message,
    });
    return;
  }
  await writeSkillMemory(ctx, skill, result.value);
  if (event.type !== 'message') return;
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

async function writeSkillMemory(
  ctx: SkillContext,
  skill: Skill,
  result: { readonly card?: unknown; readonly text?: string; readonly reasoning?: string },
): Promise<void> {
  const memoryStore = ctx.memoryStore;
  if (!memoryStore) return;

  const { chatId, userId, eventKey } = memoryEventIdentity(ctx);
  const now = Date.now();
  const summary = summarizeSkillResult(skill, result);

  const skillLog = await memoryStore.write({
    kind: 'skill_log',
    chat_id: chatId,
    key: safeMemoryKey(`skill:${skill.name}:${eventKey}:${now}`),
    ...(userId ? { user_id: safeMemoryKey(userId) } : {}),
    source_skill: skill.name,
    importance: 7,
    content: JSON.stringify({
      skill: skill.name,
      reason: result.reasoning ?? '',
      output: summary,
      at: now,
    }),
  });
  if (!skillLog.ok) {
    ctx.logger.warn('memory auto-write skill_log failed', {
      skill: skill.name,
      code: skillLog.error.code,
      message: skillLog.error.message,
    });
  }

  if (skill.name !== 'qa' && skill.name !== 'summary') return;
  const chatWrite = await memoryStore.write({
    kind: 'chat',
    chat_id: chatId,
    key: safeMemoryKey(`chat:${skill.name}:${eventKey}:${now}`),
    ...(userId ? { user_id: safeMemoryKey(userId) } : {}),
    source_skill: skill.name,
    importance: skill.name === 'summary' ? 7 : 5,
    content: JSON.stringify({
      skill: skill.name,
      input: ctx.event.type === 'message' ? ctx.event.payload.text : '',
      output: summary,
      reason: result.reasoning ?? '',
      at: now,
    }),
  });
  if (!chatWrite.ok) {
    ctx.logger.warn('memory auto-write chat failed', {
      skill: skill.name,
      code: chatWrite.error.code,
      message: chatWrite.error.message,
    });
  }
}

function memoryEventIdentity(ctx: SkillContext): {
  chatId: string;
  userId?: string;
  eventKey: string;
} {
  const { event } = ctx;
  if (event.type === 'message') {
    return {
      chatId: event.payload.chatId,
      userId: event.payload.sender.userId,
      eventKey: event.payload.messageId,
    };
  }
  if (event.type === 'cardAction') {
    return {
      chatId: event.payload.chatId,
      userId: event.payload.user.userId,
      eventKey: event.payload.messageId,
    };
  }
  if (event.type === 'botJoinedChat') {
    return {
      chatId: event.payload.chatId,
      userId: event.payload.inviter.userId,
      eventKey: `botJoined:${event.payload.timestamp}`,
    };
  }
  if (event.type === 'schedule') {
    return {
      chatId: event.payload.chatId,
      eventKey: `schedule:${event.payload.skillName}:${event.payload.timestamp}`,
    };
  }
  return {
    chatId: event.payload.chatId,
    userId: event.payload.user.userId,
    eventKey: `p2p:${event.payload.timestamp}`,
  };
}

function summarizeSkillResult(
  skill: Skill,
  result: { readonly card?: unknown; readonly text?: string; readonly reasoning?: string },
): string {
  const text = result.text?.trim();
  if (text) return text.slice(0, 500);
  if (result.reasoning) return result.reasoning.slice(0, 500);
  if (result.card) return `${skill.name} produced a card`;
  return `${skill.name} completed`;
}

function safeMemoryKey(raw: string): string {
  const key = raw.replace(/[^A-Za-z0-9_:.-]+/g, '_').slice(0, 120);
  return key.length > 0 ? key : 'unknown';
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
  await runSkill(replayCtx, qa);
  logger.info(`skill=qa reanswer requested chat=${chatId}`);
}

async function handleSchedule(
  ctx: SkillContext,
  skills: Readonly<Partial<Record<SkillName, Skill>>>,
): Promise<void> {
  const { event } = ctx;
  if (event.type !== 'schedule') return;
  const skillName = event.payload.skillName as SkillName;
  const skill = skills[skillName];
  if (!skill) {
    ctx.logger.warn('schedule selected missing skill', { skill: event.payload.skillName });
    return;
  }
  if (!(await skill.match(ctx))) return;
  await runSkill(ctx, skill);
}
