import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slidesSkill } from '../slides.js';
import { ok, err, makeError, ErrorCode } from '@seedhac/contracts';
import type {
  BotEvent,
  BotRuntime,
  Card,
  CardBuilder,
  LLMClient,
  Message,
  SkillContext,
} from '@seedhac/contracts';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeMessage(text: string, overrides: Partial<Message> = {}): Message {
  return {
    messageId: 'msg_001',
    chatId: 'oc_chat_001',
    chatType: 'group',
    sender: { userId: 'ou_user_001', name: '张三' },
    contentType: 'text',
    text,
    rawContent: text,
    mentions: [],
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function makeEvent(text: string, overrides?: Partial<Message>): BotEvent {
  return { type: 'message', payload: makeMessage(text, overrides) };
}

const MOCK_OUTLINE = {
  title: '项目进展汇报',
  subtitle: '基于 IM 的办公协同智能助手',
  slides: [
    { type: 'cover' as const, title: '项目进展汇报', subtitle: '基于 IM 的办公协同智能助手' },
    {
      type: 'overview' as const,
      title: '核心进展',
      presenterName: '张三',
      cards: [
        { title: 'MVP 开发', value: '已完成', detail: '核心链路可演示' },
        { title: '测试覆盖', value: '进行中', detail: '补齐关键场景' },
      ],
    },
    {
      type: 'nextSteps' as const,
      title: '下一步计划',
      presenterName: '李四',
      tasks: [
        { owner: '张三', task: '上线演示', due: '明天' },
        { owner: '李四', task: '收集反馈' },
      ],
    },
  ],
};

const MOCK_SLIDES_REF = {
  slidesToken: 'sldcnABCDEF',
  url: 'https://example.feishu.cn/slides/abc',
};
const MOCK_ASSIGNMENT = {
  assignments: [
    {
      memberName: '张三',
      pages: [
        { pageIndex: 0, heading: '项目背景', talkingPoints: ['先讲问题背景', '说明目标收益'] },
      ],
    },
  ],
};
const MOCK_DOC_REF = { docToken: 'doxcnABCDEF', url: 'https://example.feishu.cn/docx/abc' };
const MOCK_SLIDES_CARD: Card = { templateName: 'slides', content: { slides: true } };
const MOCK_DOC_PUSH_CARD: Card = { templateName: 'docPush', content: { docPush: true } };

function makeRuntime(): BotRuntime {
  return {
    on: vi.fn(),
    start: vi.fn().mockResolvedValue(ok(undefined)),
    stop: vi.fn().mockResolvedValue(undefined),
    sendText: vi
      .fn()
      .mockResolvedValue(ok({ messageId: 'r1', chatId: 'oc_chat_001', timestamp: 0 })),
    sendCard: vi
      .fn()
      .mockResolvedValue(ok({ messageId: 'r2', chatId: 'oc_chat_001', timestamp: 0 })),
    patchCard: vi.fn().mockResolvedValue(ok(undefined)),
    fetchHistory: vi
      .fn()
      .mockResolvedValue(
        ok({ messages: [makeMessage('我们做个ppt汇报一下进展')], hasMore: false }),
      ),
    fetchMembers: vi
      .fn()
      .mockResolvedValue(ok({ members: [{ userId: 'ou_user_001', name: '张三' }] })),
  } as unknown as BotRuntime;
}

function makeLLM(outline = MOCK_OUTLINE): LLMClient {
  return {
    ask: vi.fn(),
    chat: vi.fn(),
    askStructured: vi
      .fn()
      .mockResolvedValueOnce(ok(outline))
      .mockResolvedValue(ok(MOCK_ASSIGNMENT)),
  } as unknown as LLMClient;
}

function makeCardBuilder(): CardBuilder {
  return {
    build: vi
      .fn()
      .mockImplementation((template) =>
        template === 'docPush' ? MOCK_DOC_PUSH_CARD : MOCK_SLIDES_CARD,
      ),
  };
}

function makeCtx(event: BotEvent, overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    event,
    runtime: makeRuntime(),
    llm: makeLLM(),
    bitable: {
      find: vi.fn().mockResolvedValue(ok({ records: [], hasMore: false })),
      insert: vi.fn(),
      batchInsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      link: vi.fn(),
    } as unknown as SkillContext['bitable'],
    docx: {
      create: vi.fn(),
      appendBlocks: vi.fn(),
      getShareLink: vi.fn(),
      createFromMarkdown: vi.fn().mockResolvedValue(ok(MOCK_DOC_REF)),
      grantMembersEdit: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as SkillContext['docx'],
    slides: {
      createFromOutline: vi.fn().mockResolvedValue(ok(MOCK_SLIDES_REF)),
      grantMembersEdit: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as NonNullable<SkillContext['slides']>,
    cardBuilder: makeCardBuilder(),
    retrievers: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

// ─── match() ──────────────────────────────────────────────────────────────────

describe('slidesSkill.match()', () => {
  it('returns true for message containing "ppt" (lowercase)', () => {
    expect(slidesSkill.match(makeCtx(makeEvent('我们做个ppt汇报')))).toBe(true);
  });

  it('returns true for message containing "PPT" (uppercase)', () => {
    expect(slidesSkill.match(makeCtx(makeEvent('下周要交PPT')))).toBe(true);
  });

  it('returns true for a request to organize slides', () => {
    expect(slidesSkill.match(makeCtx(makeEvent('帮忙整理一下幻灯片初稿')))).toBe(true);
  });

  it('returns true for a request to generate a presentation', () => {
    expect(slidesSkill.match(makeCtx(makeEvent('根据项目进展生成演示文稿')))).toBe(true);
  });

  it('returns true for "向上级汇报"', () => {
    expect(slidesSkill.match(makeCtx(makeEvent('需要向上级汇报项目进展')))).toBe(true);
  });

  it('returns true for "做个演示"', () => {
    expect(slidesSkill.match(makeCtx(makeEvent('给老板做个演示')))).toBe(true);
  });

  it('returns false for unrelated message', () => {
    expect(slidesSkill.match(makeCtx(makeEvent('今天天气不错')))).toBe(false);
  });

  it('returns false when the group is merely discussing ppt', () => {
    expect(slidesSkill.match(makeCtx(makeEvent('这个ppt怎么样')))).toBe(false);
    expect(slidesSkill.match(makeCtx(makeEvent('这个 ppt 风格太丑了')))).toBe(false);
    expect(slidesSkill.match(makeCtx(makeEvent('上次 PPT 放哪了')))).toBe(false);
    expect(slidesSkill.match(makeCtx(makeEvent('我们先别做 ppt')))).toBe(false);
  });

  it('returns false for non-message event', () => {
    const ctx = makeCtx({
      type: 'botJoinedChat',
      payload: { chatId: 'c1', inviter: { userId: 'u1' }, timestamp: 0 },
    });
    expect(slidesSkill.match(ctx)).toBe(false);
  });
});

// ─── run() — happy path ───────────────────────────────────────────────────────

describe('slidesSkill.run() — happy path', () => {
  let ctx: SkillContext;

  beforeEach(() => {
    ctx = makeCtx(makeEvent('下周要做PPT汇报'));
  });

  it('returns ok with an assignment docPush card', async () => {
    const result = await slidesSkill.run(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.card?.templateName).toBe('docPush');
    }
  });

  it('sends loading card, patches final slides card, and returns assignment card', async () => {
    await slidesSkill.run(ctx);
    expect(ctx.cardBuilder.build).toHaveBeenCalledWith(
      'slides',
      expect.objectContaining({
        title: '文件生成中…',
        isLoading: true,
      }),
    );
    expect(ctx.runtime.sendCard).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'oc_chat_001', card: MOCK_SLIDES_CARD }),
    );
    expect(ctx.cardBuilder.build).toHaveBeenCalledWith(
      'slides',
      expect.objectContaining({
        title: MOCK_OUTLINE.title,
        presentationUrl: MOCK_SLIDES_REF.url,
        pageCount: MOCK_OUTLINE.slides.length,
      }),
    );
    expect(ctx.runtime.patchCard).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'r2', card: MOCK_SLIDES_CARD }),
    );
    expect(ctx.cardBuilder.build).toHaveBeenCalledWith(
      'docPush',
      expect.objectContaining({
        docTitle: `${MOCK_OUTLINE.title} — 汇报分工`,
        docUrl: MOCK_DOC_REF.url,
        docType: 'report',
      }),
    );
  });

  it('calls slides.createFromOutline with outline title', async () => {
    await slidesSkill.run(ctx);
    expect(ctx.slides?.createFromOutline).toHaveBeenCalledWith(MOCK_OUTLINE.title, MOCK_OUTLINE);
  });

  it('only calls LLM once and builds assignment locally', async () => {
    await slidesSkill.run(ctx);
    expect(ctx.llm.askStructured).toHaveBeenCalledTimes(1);
    expect(ctx.logger.info).toHaveBeenCalledWith(
      'slides: building assignment locally',
      expect.objectContaining({ memberCount: 1 }),
    );
  });

  it('uses LLM-provided presenterName when building assignment doc', async () => {
    const ctx = makeCtx(makeEvent('下周要做PPT汇报'), {
      runtime: {
        ...makeRuntime(),
        fetchMembers: vi.fn().mockResolvedValue(
          ok({
            members: [
              { userId: 'ou_user_001', name: '张三' },
              { userId: 'ou_user_002', name: '李四' },
            ],
          }),
        ),
      } as unknown as BotRuntime,
    });

    await slidesSkill.run(ctx);

    expect(ctx.docx.createFromMarkdown).toHaveBeenCalledWith(
      `${MOCK_OUTLINE.title} — 汇报分工`,
      expect.stringMatching(
        /## 张三[\s\S]*第 2 页：核心进展[\s\S]*## 李四[\s\S]*第 3 页：下一步计划/,
      ),
    );
  });

  it('grants slides access to team members via lark-cli user identity', async () => {
    await slidesSkill.run(ctx);
    expect(ctx.slides?.grantMembersEdit).toHaveBeenCalledWith(
      MOCK_SLIDES_REF.slidesToken,
      ['ou_user_001'],
    );
  });

  it('calls runtime.fetchHistory for the correct chatId', async () => {
    await slidesSkill.run(ctx);
    expect(ctx.runtime.fetchHistory).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'oc_chat_001' }),
    );
  });

  it('sends loading card before creating files', async () => {
    await slidesSkill.run(ctx);
    const sendOrder = (ctx.runtime.sendCard as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const createOrder = (ctx.slides!.createFromOutline as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(sendOrder).toBeDefined();
    expect(createOrder).toBeDefined();
    if (sendOrder === undefined || createOrder === undefined) throw new Error('missing call order');
    expect(sendOrder).toBeLessThan(createOrder);
  });

  it('includes reasoning in the result', async () => {
    const result = await slidesSkill.run(ctx);
    if (result.ok) {
      expect(result.value.reasoning).toBeDefined();
    }
  });
});

// ─── run() — error paths ──────────────────────────────────────────────────────

describe('slidesSkill.run() — error paths', () => {
  it('returns err when fetchHistory fails', async () => {
    const ctx = makeCtx(makeEvent('做个ppt'), {
      runtime: {
        ...makeRuntime(),
        fetchHistory: vi
          .fn()
          .mockResolvedValue(err(makeError(ErrorCode.FEISHU_API_ERROR, 'history fetch failed'))),
      } as unknown as BotRuntime,
    });
    const result = await slidesSkill.run(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.FEISHU_API_ERROR);
  });

  it('returns err when slides client is missing', async () => {
    const ctx = makeCtx(makeEvent('做个ppt')) as SkillContext & { slides?: never };
    delete ctx.slides;
    const result = await slidesSkill.run(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.CONFIG_MISSING);
  });

  it('returns err when LLM times out', async () => {
    const ctx = makeCtx(makeEvent('做个ppt'), {
      llm: {
        ask: vi.fn(),
        chat: vi.fn(),
        askStructured: vi
          .fn()
          .mockResolvedValue(err(makeError(ErrorCode.LLM_TIMEOUT, 'llm timed out'))),
      } as unknown as LLMClient,
    });
    const result = await slidesSkill.run(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.LLM_TIMEOUT);
  });

  it('returns err when slides.createFromOutline fails', async () => {
    const ctx = makeCtx(makeEvent('做个ppt'), {
      slides: {
        createFromOutline: vi
          .fn()
          .mockResolvedValue(err(makeError(ErrorCode.FEISHU_API_ERROR, 'slides create failed'))),
      } as unknown as NonNullable<SkillContext['slides']>,
    });
    const result = await slidesSkill.run(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.FEISHU_API_ERROR);
  });

  it('proceeds when fetchMembers fails and still creates assignment doc', async () => {
    const ctx = makeCtx(makeEvent('做个ppt'), {
      runtime: {
        ...makeRuntime(),
        fetchMembers: vi
          .fn()
          .mockResolvedValue(err(makeError(ErrorCode.FEISHU_API_ERROR, 'members failed'))),
      } as unknown as BotRuntime,
    });

    const result = await slidesSkill.run(ctx);

    expect(result.ok).toBe(true);
    expect(ctx.docx.createFromMarkdown).toHaveBeenCalledWith(
      `${MOCK_OUTLINE.title} — 汇报分工`,
      expect.stringContaining('张三'),
    );
  });

  it('returns err and patches error card when assignment doc creation fails', async () => {
    const ctx = makeCtx(makeEvent('做个ppt'), {
      docx: {
        create: vi.fn(),
        appendBlocks: vi.fn(),
        getShareLink: vi.fn(),
        createFromMarkdown: vi
          .fn()
          .mockResolvedValue(err(makeError(ErrorCode.FEISHU_API_ERROR, 'assignment doc failed'))),
        grantMembersEdit: vi.fn().mockResolvedValue(ok(undefined)),
      } as unknown as SkillContext['docx'],
    });

    const result = await slidesSkill.run(ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.FEISHU_API_ERROR);
    expect(ctx.cardBuilder.build).toHaveBeenCalledWith(
      'slides',
      expect.objectContaining({
        errorMessage: expect.stringContaining('assignment doc failed'),
      }),
    );
    expect(ctx.runtime.patchCard).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'r2', card: MOCK_SLIDES_CARD }),
    );
  });

  it('does not fail the flow when final patchCard fails', async () => {
    const ctx = makeCtx(makeEvent('做个ppt'), {
      runtime: {
        ...makeRuntime(),
        patchCard: vi
          .fn()
          .mockResolvedValue(err(makeError(ErrorCode.FEISHU_API_ERROR, 'patch failed'))),
      } as unknown as BotRuntime,
    });

    const result = await slidesSkill.run(ctx);

    expect(result.ok).toBe(true);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'slides: patch loading card failed',
      expect.objectContaining({ message: 'patch failed' }),
    );
  });

  it('does not build final cards when slides creation fails', async () => {
    const cardBuilder = makeCardBuilder();
    const ctx = makeCtx(makeEvent('做个ppt'), {
      slides: {
        createFromOutline: vi
          .fn()
          .mockResolvedValue(err(makeError(ErrorCode.FEISHU_API_ERROR, 'slides create failed'))),
      } as unknown as NonNullable<SkillContext['slides']>,
      cardBuilder,
    });
    await slidesSkill.run(ctx);
    expect(cardBuilder.build).toHaveBeenCalledTimes(1);
    expect(cardBuilder.build).toHaveBeenCalledWith(
      'slides',
      expect.objectContaining({ isLoading: true }),
    );
  });
});

// ─── Bitable snapshot graceful degradation ───────────────────────────────────

describe('slidesSkill.run() — bitable snapshot degradation', () => {
  it('proceeds without snapshots when bitable.find fails', async () => {
    const ctx = makeCtx(makeEvent('做个ppt'), {
      bitable: {
        find: vi.fn().mockResolvedValue(err(makeError(ErrorCode.BITABLE_QPS, 'qps exceeded'))),
        insert: vi.fn(),
        batchInsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        link: vi.fn(),
      } as unknown as SkillContext['bitable'],
    });
    const result = await slidesSkill.run(ctx);
    // Still succeeds — snapshots are optional
    expect(result.ok).toBe(true);
  });
});
