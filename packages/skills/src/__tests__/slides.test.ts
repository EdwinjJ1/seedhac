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
  slides: [
    { heading: '项目背景', bullets: ['解决团队协作问题', '提升效率 30%'] },
    { heading: '核心进展', bullets: ['完成 MVP 开发', '完成测试覆盖'] },
    { heading: '下一步计划', bullets: ['上线演示', '收集反馈'] },
  ],
};

const MOCK_SLIDES_REF = {
  slidesToken: 'sldcnABCDEF',
  url: 'https://example.feishu.cn/slides/abc',
};
const MOCK_CARD: Card = { templateName: 'slides', content: { mock: true } };

function makeRuntime(): BotRuntime {
  return {
    on: vi.fn(),
    start: vi.fn().mockResolvedValue(ok(undefined)),
    stop: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn().mockResolvedValue(ok({ messageId: 'r1', chatId: 'oc_chat_001', timestamp: 0 })),
    sendCard: vi.fn().mockResolvedValue(ok({ messageId: 'r2', chatId: 'oc_chat_001', timestamp: 0 })),
    patchCard: vi.fn().mockResolvedValue(ok(undefined)),
    fetchHistory: vi.fn().mockResolvedValue(
      ok({ messages: [makeMessage('我们做个ppt汇报一下进展')], hasMore: false }),
    ),
  } as unknown as BotRuntime;
}

function makeLLM(outline = MOCK_OUTLINE): LLMClient {
  return {
    ask: vi.fn(),
    chat: vi.fn(),
    askStructured: vi.fn().mockResolvedValue(ok(outline)),
  } as unknown as LLMClient;
}

function makeCardBuilder(): CardBuilder {
  return { build: vi.fn().mockReturnValue(MOCK_CARD) };
}

function makeCtx(
  event: BotEvent,
  overrides: Partial<SkillContext> = {},
): SkillContext {
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
      createFromMarkdown: vi.fn(),
    } as unknown as SkillContext['docx'],
    slides: {
      createFromOutline: vi.fn().mockResolvedValue(ok(MOCK_SLIDES_REF)),
    } as unknown as SkillContext['slides'],
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

  it('returns true for "幻灯片"', () => {
    expect(slidesSkill.match(makeCtx(makeEvent('幻灯片初稿出来了')))).toBe(true);
  });

  it('returns true for "演示文稿"', () => {
    expect(slidesSkill.match(makeCtx(makeEvent('演示文稿风格参考上次的')))).toBe(true);
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

  it('returns false for non-message event', () => {
    const ctx = makeCtx({ type: 'botJoinedChat', payload: { chatId: 'c1', inviter: { userId: 'u1' }, timestamp: 0 } });
    expect(slidesSkill.match(ctx)).toBe(false);
  });
});

// ─── run() — happy path ───────────────────────────────────────────────────────

describe('slidesSkill.run() — happy path', () => {
  let ctx: SkillContext;

  beforeEach(() => {
    ctx = makeCtx(makeEvent('下周要做PPT汇报'));
  });

  it('returns ok with a slides card', async () => {
    const result = await slidesSkill.run(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.card?.templateName).toBe('slides');
    }
  });

  it('calls cardBuilder.build with slides template and correct data', async () => {
    await slidesSkill.run(ctx);
    expect(ctx.cardBuilder.build).toHaveBeenCalledWith('slides', expect.objectContaining({
      title: MOCK_OUTLINE.title,
      presentationUrl: MOCK_SLIDES_REF.url,
      pageCount: MOCK_OUTLINE.slides.length,
    }));
  });

  it('calls slides.createFromOutline with outline title', async () => {
    await slidesSkill.run(ctx);
    expect(ctx.slides.createFromOutline).toHaveBeenCalledWith(
      MOCK_OUTLINE.title,
      MOCK_OUTLINE,
    );
  });

  it('calls runtime.fetchHistory for the correct chatId', async () => {
    await slidesSkill.run(ctx);
    expect(ctx.runtime.fetchHistory).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'oc_chat_001' }),
    );
  });

  it('sends an immediate progress acknowledgement', async () => {
    await slidesSkill.run(ctx);
    expect(ctx.runtime.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'oc_chat_001',
        text: expect.stringContaining('正在生成演示文稿'),
      }),
    );
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
        fetchHistory: vi.fn().mockResolvedValue(
          err(makeError(ErrorCode.FEISHU_API_ERROR, 'history fetch failed')),
        ),
      } as unknown as BotRuntime,
    });
    const result = await slidesSkill.run(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.FEISHU_API_ERROR);
  });

  it('returns err when LLM times out', async () => {
    const ctx = makeCtx(makeEvent('做个ppt'), {
      llm: {
        ask: vi.fn(),
        chat: vi.fn(),
        askStructured: vi.fn().mockResolvedValue(
          err(makeError(ErrorCode.LLM_TIMEOUT, 'llm timed out')),
        ),
      } as unknown as LLMClient,
    });
    const result = await slidesSkill.run(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.LLM_TIMEOUT);
  });

  it('returns err when slides.createFromOutline fails', async () => {
    const ctx = makeCtx(makeEvent('做个ppt'), {
      slides: {
        createFromOutline: vi.fn().mockResolvedValue(
          err(makeError(ErrorCode.FEISHU_API_ERROR, 'slides create failed')),
        ),
      } as unknown as SkillContext['slides'],
    });
    const result = await slidesSkill.run(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.FEISHU_API_ERROR);
  });

  it('does not call cardBuilder.build when slides creation fails', async () => {
    const cardBuilder = makeCardBuilder();
    const ctx = makeCtx(makeEvent('做个ppt'), {
      slides: {
        createFromOutline: vi.fn().mockResolvedValue(
          err(makeError(ErrorCode.FEISHU_API_ERROR, 'slides create failed')),
        ),
      } as unknown as SkillContext['slides'],
      cardBuilder,
    });
    await slidesSkill.run(ctx);
    expect(cardBuilder.build).not.toHaveBeenCalled();
  });
});

// ─── Bitable snapshot graceful degradation ───────────────────────────────────

describe('slidesSkill.run() — bitable snapshot degradation', () => {
  it('proceeds without snapshots when bitable.find fails', async () => {
    const ctx = makeCtx(makeEvent('做个ppt'), {
      bitable: {
        find: vi.fn().mockResolvedValue(
          err(makeError(ErrorCode.BITABLE_QPS, 'qps exceeded')),
        ),
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
