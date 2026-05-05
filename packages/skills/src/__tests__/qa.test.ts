import { describe, it, expect, vi, beforeEach } from 'vitest';
import { qaSkill } from '../qa.js';
import { err, ErrorCode, makeError, ok } from '@seedhac/contracts';
import type {
  BotEvent,
  BotRuntime,
  Card,
  CardBuilder,
  LLMClient,
  Message,
  Retriever,
  SkillContext,
} from '@seedhac/contracts';

const BOT_ID = 'ou_bot_qa';
const MOCK_CARD: Card = { templateName: 'qa', content: { mock: true } };

function makeMessage(text: string, overrides: Partial<Message> = {}): Message {
  return {
    messageId: 'msg_001',
    chatId: 'oc_chat_001',
    chatType: 'group',
    sender: { userId: 'ou_user_001', name: '张三' },
    contentType: 'text',
    text,
    rawContent: text,
    mentions: [{ user: { userId: BOT_ID }, key: '@_bot' }],
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function makeEvent(text: string, overrides?: Partial<Message>): BotEvent {
  return { type: 'message', payload: makeMessage(text, overrides) };
}

function makeRuntime(messages?: readonly Message[]): BotRuntime {
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
    fetchHistory: vi.fn().mockResolvedValue(
      ok({
        messages: messages ?? [
          makeMessage('谁负责接口联调？', { messageId: 'msg_001' }),
          makeMessage('王五负责接口联调', {
            messageId: 'msg_002',
            sender: { userId: 'ou_user_002' },
          }),
          makeMessage('本周五前完成验收', { messageId: 'msg_003' }),
        ],
        hasMore: false,
      }),
    ),
  } as unknown as BotRuntime;
}

function makeLLM(answer = '王五负责接口联调，本周五前完成验收。\nSOURCES: 1,2'): LLMClient {
  return {
    ask: vi.fn().mockResolvedValue(ok(answer)),
    chat: vi.fn(),
    askStructured: vi.fn(),
  } as unknown as LLMClient;
}

function makeCardBuilder(): CardBuilder {
  return { build: vi.fn().mockReturnValue(MOCK_CARD) };
}

function makeRetriever(): Retriever {
  return {
    source: 'chat',
    retrieve: vi.fn().mockResolvedValue(
      ok([
        {
          source: 'chat',
          id: 'msg_002',
          title: '群聊历史',
          snippet: '王五负责接口联调，本周五前完成验收',
          score: 0.9,
          timestamp: 1_700_000_001_000,
          meta: { authorName: '王五' },
        },
        {
          source: 'chat',
          id: 'msg_003',
          title: '群聊历史',
          snippet: '李四负责前端页面接入',
          score: 0.8,
          timestamp: 1_700_000_002_000,
          meta: { authorName: '李四' },
        },
      ]),
    ),
  };
}

function makeCtx(event: BotEvent, overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    event,
    runtime: makeRuntime(),
    llm: makeLLM(),
    bitable: {
      find: vi.fn(),
      insert: vi.fn(),
      batchInsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      link: vi.fn(),
      readTable: vi.fn().mockResolvedValue(ok('')),
    } as unknown as SkillContext['bitable'],
    docx: {
      create: vi.fn(),
      appendBlocks: vi.fn(),
      getShareLink: vi.fn(),
      createFromMarkdown: vi.fn(),
      readContent: vi.fn().mockResolvedValue(ok('')),
    } as unknown as SkillContext['docx'],
    cardBuilder: makeCardBuilder(),
    retrievers: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe('qaSkill.match()', () => {
  beforeEach(() => {
    process.env['LARK_BOT_OPEN_ID'] = BOT_ID;
  });

  it('returns true for @bot + question intent', () => {
    expect(qaSkill.match(makeCtx(makeEvent('这个功能怎么用？')))).toBe(true);
  });

  it('returns false without @mention', () => {
    const ctx = makeCtx(makeEvent('这个功能怎么用？', { mentions: [] }));
    expect(qaSkill.match(ctx)).toBe(false);
  });

  it('returns false for @bot without question intent', () => {
    expect(qaSkill.match(makeCtx(makeEvent('大家好')))).toBe(false);
  });

  it('returns false for non-message events', () => {
    const ctx = makeCtx({
      type: 'botJoinedChat',
      payload: { chatId: 'c1', inviter: { userId: 'u1' }, timestamp: 0 },
    });
    expect(qaSkill.match(ctx)).toBe(false);
  });
});

describe('qaSkill.run()', () => {
  beforeEach(() => {
    process.env['LARK_BOT_OPEN_ID'] = BOT_ID;
  });

  it('uses retriever and LLM to return a qa card', async () => {
    const retriever = makeRetriever();
    const ctx = makeCtx(makeEvent('谁负责接口联调？'), {
      retrievers: { chat: retriever },
    });

    const result = await qaSkill.run(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.card?.templateName).toBe('qa');
      expect(result.value.text).toBeUndefined();
    }
    expect(retriever.retrieve).toHaveBeenCalledWith({
      query: '谁负责接口联调？',
      chatId: 'oc_chat_001',
      topK: 5,
    });
    expect(ctx.runtime.fetchHistory).toHaveBeenCalledWith({ chatId: 'oc_chat_001', pageSize: 30 });
    expect(ctx.cardBuilder.build).toHaveBeenCalledWith('qa', {
      question: '谁负责接口联调？',
      answer: '王五负责接口联调，本周五前完成验收。',
      sources: [
        expect.objectContaining({
          kind: 'chat',
          title: '群聊历史',
          snippet: '王五负责接口联调，本周五前完成验收',
          authorName: '王五',
          timestamp: 1_700_000_001_000,
          messageId: 'msg_002',
        }),
        expect.objectContaining({
          kind: 'chat',
          title: '群聊历史',
          snippet: '李四负责前端页面接入',
          authorName: '李四',
          timestamp: 1_700_000_002_000,
          messageId: 'msg_003',
        }),
      ],
      buttons: [
        expect.objectContaining({
          text: '重新回答',
          value: {
            action: 'qa.reanswer',
            questionMessageId: 'msg_001',
            chatId: 'oc_chat_001',
          },
        }),
      ],
    });
  });

  it('falls back to fetchHistory when no retriever is injected', async () => {
    const ctx = makeCtx(makeEvent('谁负责接口联调？'));

    const result = await qaSkill.run(ctx);

    expect(result.ok).toBe(true);
    expect(ctx.runtime.fetchHistory).toHaveBeenCalledWith({ chatId: 'oc_chat_001', pageSize: 30 });
    expect(ctx.llm.ask).toHaveBeenCalledWith(expect.stringContaining('王五负责接口联调'), {
      model: 'pro',
    });
    expect(ctx.llm.ask).not.toHaveBeenCalledWith(expect.stringContaining('ou_user_002'), {
      model: 'pro',
    });
    expect(ctx.llm.ask).not.toHaveBeenCalledWith(
      expect.stringContaining('谁负责接口联调？\n王五'),
      {
        model: 'pro',
      },
    );
    expect(ctx.llm.ask).not.toHaveBeenCalledWith(
      expect.stringContaining('张三: 谁负责接口联调？'),
      {
        model: 'pro',
      },
    );
  });

  it('reads linked Feishu docs and bitables from recent history as QA context', async () => {
    const docUrl = 'https://bytedance.larkoffice.com/wiki/doccnabc123456';
    const bitableUrl =
      'https://bytedance.larkoffice.com/base/appabc123456?view=vew1&table=tblxyz987';
    const history = [
      makeMessage(`需求文档在这里：${docUrl}`, {
        messageId: 'doc_share',
        sender: { userId: 'ou_user_002', name: '王五' },
      }),
      makeMessage(`分工表在这里：${bitableUrl}`, {
        messageId: 'table_share',
        sender: { userId: 'ou_user_003', name: '李四' },
      }),
    ];
    const ctx = makeCtx(makeEvent('验收标准和接口联调负责人是什么？'), {
      runtime: makeRuntime(history),
      llm: makeLLM('验收标准是 5 月 6 日前完成自测；接口联调负责人是王五。\nSOURCES: 1,2'),
    });
    vi.mocked(ctx.docx.readContent).mockResolvedValue(ok('验收标准：5 月 6 日前完成自测。'));
    vi.mocked(ctx.bitable.readTable).mockResolvedValue(ok('负责人 | 任务\n王五 | 接口联调'));

    const result = await qaSkill.run(ctx);

    expect(result.ok).toBe(true);
    expect(ctx.docx.readContent).toHaveBeenCalledWith('doccnabc123456', 'wiki');
    expect(ctx.bitable.readTable).toHaveBeenCalledWith('appabc123456', 'tblxyz987', 50);
    expect(ctx.llm.ask).toHaveBeenCalledWith(
      expect.stringContaining('验收标准：5 月 6 日前完成自测'),
      {
        model: 'pro',
      },
    );
    expect(ctx.llm.ask).toHaveBeenCalledWith(expect.stringContaining('王五 | 接口联调'), {
      model: 'pro',
    });
    expect(ctx.cardBuilder.build).toHaveBeenCalledWith(
      'qa',
      expect.objectContaining({
        sources: [
          expect.objectContaining({
            kind: 'wiki',
            title: expect.stringContaining('飞书 Wiki'),
            url: docUrl,
            snippet: expect.stringContaining('验收标准'),
          }),
          expect.objectContaining({
            kind: 'bitable',
            title: '多维表格 tblxyz987',
            url: bitableUrl,
            snippet: expect.stringContaining('王五 | 接口联调'),
          }),
        ],
      }),
    );
  });

  it('returns text instead of card when LLM reports insufficient context', async () => {
    const ctx = makeCtx(makeEvent('这个指标在哪里？'), {
      llm: makeLLM('INSUFFICIENT_CONTEXT'),
    });

    const result = await qaSkill.run(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('暂时找不到相关记录，建议直接在群里问一下。');
      expect(result.value.card).toBeUndefined();
    }
    expect(ctx.cardBuilder.build).not.toHaveBeenCalled();
  });

  it('returns err when LLM times out', async () => {
    const ctx = makeCtx(makeEvent('谁负责接口联调？'), {
      llm: {
        ask: vi.fn().mockResolvedValue(err(makeError(ErrorCode.LLM_TIMEOUT, 'llm timed out'))),
        chat: vi.fn(),
        askStructured: vi.fn(),
      } as unknown as LLMClient,
    });

    const result = await qaSkill.run(ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.LLM_TIMEOUT);
    expect(ctx.cardBuilder.build).not.toHaveBeenCalled();
  });
});
