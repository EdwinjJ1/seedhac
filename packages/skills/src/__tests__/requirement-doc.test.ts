import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requirementDocSkill } from '../requirement-doc.js';
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

function makeEvent(text: string): BotEvent {
  return { type: 'message', payload: makeMessage(text) };
}

const MOCK_DOC = {
  title: '飞书智能助手 PRD',
  background: '群协作信息散落，需要一个 Bot 把对话织成结构化产出。',
  goals: ['自动整理需求', '主动浮信息', '生成演示文稿'],
  scope: '只覆盖群聊场景，不监听 1v1 私聊。',
  deliverables: ['需求文档', '分工表格', 'PPT 初稿'],
};

const MOCK_DOC_REF = { docToken: 'doxcnFAKE', url: 'https://example.feishu.cn/docx/doxcnFAKE' };
const MOCK_CARD: Card = { templateName: 'docPush', content: { built: true } };

function makeRuntime(): BotRuntime {
  return {
    on: vi.fn(),
    start: vi.fn().mockResolvedValue(ok(undefined)),
    stop: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn(),
    sendCard: vi.fn(),
    patchCard: vi.fn(),
    fetchHistory: vi.fn().mockResolvedValue(
      ok({
        messages: [
          makeMessage('以下是我们本次项目的需求'),
          makeMessage('要做一个住在群里的 Bot'),
        ],
        hasMore: false,
      }),
    ),
  } as unknown as BotRuntime;
}

function makeLLM(doc = MOCK_DOC): LLMClient {
  return {
    ask: vi.fn(),
    chat: vi.fn(),
    askStructured: vi.fn().mockResolvedValue(ok(doc)),
  } as unknown as LLMClient;
}

function makeCardBuilder(): CardBuilder {
  return { build: vi.fn().mockReturnValue(MOCK_CARD) };
}

function makeCtx(event: BotEvent, overrides: Partial<SkillContext> = {}): SkillContext {
  // requirementDoc 不依赖 slides，故 SkillContext.slides 可省略
  return {
    event,
    runtime: makeRuntime(),
    llm: makeLLM(),
    bitable: {
      find: vi.fn(),
      insert: vi.fn().mockResolvedValue(ok({ tableId: 't', recordId: 'r' })),
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
      grantMembersEdit: vi.fn(),
    } as unknown as SkillContext['docx'],
    cardBuilder: makeCardBuilder(),
    retrievers: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

// ─── match() ──────────────────────────────────────────────────────────────────

describe('requirementDocSkill.match()', () => {
  it('returns true for "以下是.*需求" pattern', () => {
    expect(
      requirementDocSkill.match(makeCtx(makeEvent('以下是我们本次项目的需求，请大家看看'))),
    ).toBe(true);
  });

  it('returns true for explicit "项目需求" / "PRD" / "需求文档"', () => {
    expect(requirementDocSkill.match(makeCtx(makeEvent('整理下项目需求')))).toBe(true);
    expect(requirementDocSkill.match(makeCtx(makeEvent('PRD 初稿在这里')))).toBe(true);
    expect(requirementDocSkill.match(makeCtx(makeEvent('该写需求文档了')))).toBe(true);
  });

  it('returns false for unrelated message (eg 会议纪要)', () => {
    expect(requirementDocSkill.match(makeCtx(makeEvent('今天会议纪要发一下')))).toBe(false);
  });

  it('returns false for non-message event', () => {
    const ctx = makeCtx({
      type: 'botJoinedChat',
      payload: { chatId: 'c1', inviter: { userId: 'u1' }, timestamp: 0 },
    });
    expect(requirementDocSkill.match(ctx)).toBe(false);
  });
});

// ─── run() — happy path ───────────────────────────────────────────────────────

describe('requirementDocSkill.run() — happy path', () => {
  let ctx: SkillContext;

  beforeEach(() => {
    ctx = makeCtx(makeEvent('整理下项目需求'));
  });

  it('returns ok with a docPush card', async () => {
    const result = await requirementDocSkill.run(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.card?.templateName).toBe('docPush');
  });

  it('calls docx.createFromMarkdown with extracted title and rendered markdown', async () => {
    await requirementDocSkill.run(ctx);
    expect(ctx.docx.createFromMarkdown).toHaveBeenCalledWith(
      MOCK_DOC.title,
      expect.stringContaining(MOCK_DOC.background),
    );
    // 关键 section 都序列化进 markdown
    const [, md] = (ctx.docx.createFromMarkdown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(md).toContain('## 项目背景');
    expect(md).toContain('## 目标');
    expect(md).toContain('## 范围');
    expect(md).toContain('## 交付物');
    for (const goal of MOCK_DOC.goals) expect(md).toContain(`- ${goal}`);
    for (const d of MOCK_DOC.deliverables) expect(md).toContain(`- ${d}`);
  });

  it('inserts a memory row with docToken + chatId + type=requirement', async () => {
    await requirementDocSkill.run(ctx);
    expect(ctx.bitable.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'memory',
        row: expect.objectContaining({
          chatId: 'oc_chat_001',
          type: 'requirement',
          docToken: MOCK_DOC_REF.docToken,
          content: MOCK_DOC.title,
        }),
      }),
    );
  });

  it('builds docPush card with docType=requirement and feishu URL', async () => {
    await requirementDocSkill.run(ctx);
    expect(ctx.cardBuilder.build).toHaveBeenCalledWith(
      'docPush',
      expect.objectContaining({
        docTitle: MOCK_DOC.title,
        docUrl: MOCK_DOC_REF.url,
        docType: 'requirement',
        summary: expect.stringContaining(`${MOCK_DOC.goals.length} 个目标`),
      }),
    );
  });

  it('still returns ok when bitable.insert fails (degrades gracefully)', async () => {
    const ctx2 = makeCtx(makeEvent('整理下项目需求'), {
      bitable: {
        find: vi.fn(),
        insert: vi
          .fn()
          .mockResolvedValue(err(makeError(ErrorCode.FEISHU_API_ERROR, 'bitable down'))),
        batchInsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        link: vi.fn(),
      } as unknown as SkillContext['bitable'],
    });

    const result = await requirementDocSkill.run(ctx2);

    expect(result.ok).toBe(true);
    expect(ctx2.logger.warn).toHaveBeenCalledWith(
      'requirementDoc: insert memory failed',
      expect.objectContaining({ code: ErrorCode.FEISHU_API_ERROR }),
    );
  });
});

// ─── run() — error paths ──────────────────────────────────────────────────────

describe('requirementDocSkill.run() — error paths', () => {
  it('returns err when fetchHistory fails; LLM and docx not called', async () => {
    const ctx = makeCtx(makeEvent('整理下项目需求'), {
      runtime: {
        ...makeRuntime(),
        fetchHistory: vi
          .fn()
          .mockResolvedValue(err(makeError(ErrorCode.FEISHU_API_ERROR, 'history fetch failed'))),
      } as unknown as BotRuntime,
    });

    const result = await requirementDocSkill.run(ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.FEISHU_API_ERROR);
    expect(ctx.llm.askStructured).not.toHaveBeenCalled();
    expect(ctx.docx.createFromMarkdown).not.toHaveBeenCalled();
  });

  it('returns err when LLM fails; docx.createFromMarkdown not called', async () => {
    const ctx = makeCtx(makeEvent('整理下项目需求'), {
      llm: {
        ask: vi.fn(),
        chat: vi.fn(),
        askStructured: vi
          .fn()
          .mockResolvedValue(err(makeError(ErrorCode.LLM_TIMEOUT, 'llm timed out'))),
      } as unknown as LLMClient,
    });

    const result = await requirementDocSkill.run(ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.LLM_TIMEOUT);
    expect(ctx.docx.createFromMarkdown).not.toHaveBeenCalled();
    expect(ctx.bitable.insert).not.toHaveBeenCalled();
    expect(ctx.cardBuilder.build).not.toHaveBeenCalled();
  });

  it('returns err when docx.createFromMarkdown fails; memory not written, card not built', async () => {
    const ctx = makeCtx(makeEvent('整理下项目需求'), {
      docx: {
        create: vi.fn(),
        appendBlocks: vi.fn(),
        getShareLink: vi.fn(),
        createFromMarkdown: vi
          .fn()
          .mockResolvedValue(err(makeError(ErrorCode.FEISHU_API_ERROR, 'docx create failed'))),
        grantMembersEdit: vi.fn(),
      } as unknown as SkillContext['docx'],
    });

    const result = await requirementDocSkill.run(ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.FEISHU_API_ERROR);
    expect(ctx.bitable.insert).not.toHaveBeenCalled();
    expect(ctx.cardBuilder.build).not.toHaveBeenCalled();
  });
});
