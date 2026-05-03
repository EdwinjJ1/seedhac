import { describe, it, expect, vi, beforeEach } from 'vitest';
import { qaSkill } from '@seedhac/skills';
import { err, makeError, ErrorCode, ok } from '@seedhac/contracts';
import type {
  BotEvent,
  BotRuntime,
  Message,
  Skill,
  SkillContext,
  SkillName,
} from '@seedhac/contracts';
import { SkillRouter } from '../skill-router.js';
import { handleEvent } from '../wiring.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

const BOT_ID = 'ou_bot_123';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    messageId: 'msg_1',
    chatId: 'oc_chat1',
    chatType: 'group',
    sender: { userId: 'ou_user1' },
    contentType: 'text',
    text: '这个怎么用？',
    rawContent: '',
    mentions: [{ user: { userId: BOT_ID }, key: '@_bot' }],
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeEvent(msg: Message): BotEvent {
  return { type: 'message', payload: msg };
}

function makeRuntime(): BotRuntime {
  return {
    on: vi.fn(),
    start: vi.fn().mockResolvedValue(ok(undefined)),
    stop: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn().mockResolvedValue(ok({ messageId: 'r1', chatId: 'oc_chat1', timestamp: 0 })),
    sendCard: vi.fn().mockResolvedValue(ok({ messageId: 'r2', chatId: 'oc_chat1', timestamp: 0 })),
    patchCard: vi.fn().mockResolvedValue(ok(undefined)),
    fetchHistory: vi.fn().mockResolvedValue(ok({ messages: [], hasMore: false })),
  } as unknown as BotRuntime;
}

function makeCtx(event: BotEvent, runtimeOverride?: BotRuntime): SkillContext {
  return {
    event,
    runtime: runtimeOverride ?? makeRuntime(),
    llm: {
      ask: vi.fn().mockResolvedValue(ok('这是测试回答。')),
      chat: vi.fn(),
      askStructured: vi.fn(),
    } as unknown as SkillContext['llm'],
    bitable: {} as SkillContext['bitable'],
    docx: {} as SkillContext['docx'],
    cardBuilder: {
      build: vi.fn().mockReturnValue({ templateName: 'qa', content: { mock: true } }),
    } as unknown as SkillContext['cardBuilder'],
    retrievers: {},
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('qaSkill.match()', () => {
  beforeEach(() => {
    process.env['LARK_BOT_OPEN_ID'] = BOT_ID;
  });

  // 1. @bot 但没有疑问意图 → match() 返回 false
  it('@bot without question intent → returns false', () => {
    const msg = makeMessage({
      text: '帮我查一下上周的会议记录',
      mentions: [{ user: { userId: BOT_ID }, key: '@_bot' }],
    });
    const ctx = makeCtx(makeEvent(msg));
    expect(qaSkill.match(ctx)).toBe(false);
  });

  // 2. 无 @mention → match() 返回 false
  it('no @mention → returns false', () => {
    const msg = makeMessage({ text: '这个功能怎么用？', mentions: [] });
    const ctx = makeCtx(makeEvent(msg));
    expect(qaSkill.match(ctx)).toBe(false);
  });
});

describe('handleEvent wiring', () => {
  const router = new SkillRouter(BOT_ID);

  beforeEach(() => {
    process.env['LARK_BOT_OPEN_ID'] = BOT_ID;
  });

  // 3. @bot + 问号 → 路由到 qa → run() 被调用，sendCard 被调用
  it('@bot + ? → qaSkill.run() is called and card response is sent', async () => {
    const runSpy = vi.spyOn(qaSkill, 'run');
    // Provide a history message that bigram-matches "这是什么？" so the skill
    // doesn't bail early with "找不到相关记录".
    const runtime = {
      ...makeRuntime(),
      fetchHistory: vi.fn().mockResolvedValue(
        ok({
          messages: [
            makeMessage({ messageId: 'hist_1', text: '这是飞书的问答功能', sender: { userId: 'ou_other' } }),
          ],
          hasMore: false,
        }),
      ),
    } as unknown as BotRuntime;
    const msg = makeMessage({
      text: '这是什么？',
      mentions: [{ user: { userId: BOT_ID }, key: '@_bot' }],
    });
    const ctx = makeCtx(makeEvent(msg), runtime);

    await handleEvent(ctx, router, { qa: qaSkill } as Partial<Record<SkillName, Skill>> as Record<
      SkillName,
      Skill
    >);

    expect(runSpy).toHaveBeenCalledOnce();
    expect(runtime.sendCard).toHaveBeenCalledOnce();
    expect(runtime.sendText).not.toHaveBeenCalled();
  });

  // 4. intent 无映射（taskAssignment）→ 不触发任何 skill
  it('intent with no skill mapping → run() not called', async () => {
    const mockSkill: Skill = {
      ...qaSkill,
      match: () => true,
      run: vi.fn().mockResolvedValue(ok({ text: 'x' })),
    };
    // 分工讨论触发 taskAssignment，intentToSkill 无 taskAssignment 映射
    const msg = makeMessage({ text: '张三负责前端，李四负责后端', mentions: [] });
    const ctx = makeCtx(makeEvent(msg));

    await handleEvent(ctx, router, { qa: mockSkill } as unknown as Record<SkillName, Skill>);

    expect(mockSkill.run).not.toHaveBeenCalled();
  });

  // 5. skill.run() 返回 err → 不 crash，logger.error 被调用
  it('skill.run() returns err → no crash, logger.error called', async () => {
    const failSkill: Skill = {
      ...qaSkill,
      match: () => true,
      run: vi.fn().mockResolvedValue(err(makeError(ErrorCode.FEISHU_API_ERROR, 'boom'))),
    };
    const runtime = makeRuntime();
    const msg = makeMessage({
      text: '这是什么？',
      mentions: [{ user: { userId: BOT_ID }, key: '@_bot' }],
    });
    const ctx = makeCtx(makeEvent(msg), runtime);

    await expect(
      handleEvent(ctx, router, { qa: failSkill } as unknown as Record<SkillName, Skill>),
    ).resolves.toBeUndefined();

    expect(ctx.logger.error as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    expect(runtime.sendText).not.toHaveBeenCalled();
  });

  // 6. intent='silent'（非 qa/meetingNotes 等消息）→ 不触发任何 skill
  it('silent intent → no skill triggered', async () => {
    const mockSkill: Skill = {
      ...qaSkill,
      match: () => true,
      run: vi.fn().mockResolvedValue(ok({ text: 'x' })),
    };
    // 普通聊天消息不匹配任何规则 → SkillRouter 返回 'silent'
    const msg = makeMessage({ text: '好的，明白了', mentions: [] });
    const ctx = makeCtx(makeEvent(msg));

    await handleEvent(ctx, router, { qa: mockSkill } as unknown as Record<SkillName, Skill>);

    expect(mockSkill.run).not.toHaveBeenCalled();
  });

  // 7. non-message event → 直接跳过
  it('non-message event → no skill triggered', async () => {
    const mockSkill: Skill = {
      ...qaSkill,
      match: () => true,
      run: vi.fn().mockResolvedValue(ok({ text: 'x' })),
    };
    const event: BotEvent = {
      type: 'botJoinedChat',
      payload: { chatId: 'c1', inviter: { userId: 'u1' }, timestamp: 0 },
    };
    const ctx = makeCtx(event);

    await handleEvent(ctx, router, { qa: mockSkill } as unknown as Record<SkillName, Skill>);

    expect(mockSkill.run).not.toHaveBeenCalled();
  });

  it('qa.reanswer card action fetches edited source message and sends a new card', async () => {
    const editedQuestion = makeMessage({
      messageId: 'msg_question',
      text: 'PPT 这期要直接生成飞书幻灯片吗？',
    });
    const runtime = {
      ...makeRuntime(),
      fetchHistory: vi.fn().mockResolvedValue(ok({ messages: [editedQuestion], hasMore: false })),
    } as unknown as BotRuntime;
    const mockSkill: Skill = {
      ...qaSkill,
      match: vi.fn(),
      run: vi.fn().mockResolvedValue(ok({ card: { templateName: 'qa', content: { mock: true } } })),
    };
    const event: BotEvent = {
      type: 'cardAction',
      payload: {
        chatId: 'oc_chat1',
        messageId: 'om_card1',
        user: { userId: 'ou_user1' },
        value: {
          action: 'qa.reanswer',
          questionMessageId: 'msg_question',
          chatId: 'oc_chat1',
        },
        timestamp: 0,
      },
    };
    const ctx = makeCtx(event, runtime);

    await handleEvent(ctx, router, { qa: mockSkill } as unknown as Record<SkillName, Skill>);

    expect(runtime.fetchHistory).toHaveBeenCalledWith({ chatId: 'oc_chat1', pageSize: 50 });
    expect(mockSkill.run).toHaveBeenCalledOnce();
    const replayCtx = (mockSkill.run as ReturnType<typeof vi.fn>).mock.calls[0]![0] as SkillContext;
    expect(replayCtx.event.type).toBe('message');
    if (replayCtx.event.type === 'message') {
      expect(replayCtx.event.payload.text).toBe('PPT 这期要直接生成飞书幻灯片吗？');
    }
    expect(runtime.sendCard).toHaveBeenCalledOnce();
  });
});
