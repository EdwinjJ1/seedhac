/**
 * 🅰 qa — 被动问答
 *
 * 触发：@bot + 疑问句（"...?" / "...吗" / "...呢"）
 * 数据流：群历史检索 / Wiki / Bitable → LLM 整合 → qa 卡片
 */

import type { CardSource, Message, Skill, SkillContext } from '@seedhac/contracts';
import { ok } from '@seedhac/contracts';
import { QA_PROMPT } from './prompts/qa.js';

const QUESTION_PATTERN = /[?？]|是什么|怎么|为什么|如何|谁负责|哪个|哪些|能不能|可以吗|吗[？?]?/;

interface ContextItem {
  readonly kind: CardSource['kind'];
  readonly text: string;
  readonly title: string;
  readonly url?: string;
  readonly authorName?: string;
  readonly timestamp?: number;
  readonly messageId?: string;
}

function mentionsBot(msg: Message): boolean {
  const botOpenId = process.env['LARK_BOT_OPEN_ID'];
  if (!botOpenId) return false;
  return msg.mentions.some((m) => m.user.userId === botOpenId);
}

/**
 * Bigram overlap score between a message and the question (0–1).
 * Works for Chinese without a tokenizer: every 2-char substring of the question
 * is a "keyword"; we count how many appear in the message.
 */
function bigramScore(msgText: string, question: string): number {
  if (question.length < 2) return 0;
  const bigrams = new Set<string>();
  for (let i = 0; i < question.length - 1; i++) {
    bigrams.add(question.slice(i, i + 2));
  }
  let hits = 0;
  for (const bg of bigrams) {
    if (msgText.includes(bg)) hits++;
  }
  return hits / bigrams.size;
}

function historyContextItem(msg: Message): ContextItem {
  const preview = msg.text.length > 40 ? `${msg.text.slice(0, 40)}…` : msg.text;
  return {
    kind: 'chat',
    text: msg.text,
    title: preview,
    ...(msg.sender.name ? { authorName: msg.sender.name } : {}),
    timestamp: msg.timestamp,
    messageId: msg.messageId,
  };
}

// ─── Feishu URL parsing ───────────────────────────────────────────────────────

/** Matches docx / wiki / slide / bitable URLs from any Feishu/Lark tenant. */
const FEISHU_DOC_RE =
  /https?:\/\/[^/\s)\]]*(?:feishu\.cn|lark\.cn|larkoffice\.com)\/(docx?|wiki|slides?)\/([A-Za-z0-9_-]{5,})/g;
const FEISHU_BITABLE_RE =
  /https?:\/\/[^/\s)\]]*(?:feishu\.cn|lark\.cn|larkoffice\.com)\/(?:base|bitable)\/([A-Za-z0-9_-]{5,})([^\s)\]]*)?/g;

type ParsedUrl =
  | { kind: 'doc'; token: string; url: string }
  | { kind: 'wiki'; token: string; url: string }
  | { kind: 'slides'; token: string; url: string }
  | { kind: 'bitable'; appToken: string; tableId: string; url: string };

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, out);
  }
}

function normalizeHaystack(value: string): string {
  const slashUnescaped = value.replaceAll('\\/', '/');
  try {
    return `${slashUnescaped}\n${decodeURIComponent(slashUnescaped)}`;
  } catch {
    return slashUnescaped;
  }
}

function messageHaystack(msg: Message): string {
  const parts = [msg.text, msg.rawContent].filter((s) => s.length > 0);
  if (msg.rawContent.length > 0) {
    try {
      const strings: string[] = [];
      collectStrings(JSON.parse(msg.rawContent), strings);
      parts.push(...strings);
    } catch {
      // rawContent is not always JSON; the original raw string above is enough.
    }
  }
  return normalizeHaystack(parts.join('\n'));
}

function parseFeishuUrls(messages: readonly Message[]): ParsedUrl[] {
  const seen = new Set<string>();
  const results: ParsedUrl[] = [];

  for (const msg of messages) {
    const haystack = messageHaystack(msg);

    let m: RegExpExecArray | null;
    FEISHU_DOC_RE.lastIndex = 0;
    while ((m = FEISHU_DOC_RE.exec(haystack)) !== null) {
      const type = m[1] ?? '';
      const token = m[2] ?? '';
      if (!token || seen.has(token)) continue;
      seen.add(token);
      const kind: 'doc' | 'wiki' | 'slides' = type.startsWith('doc')
        ? 'doc'
        : type === 'wiki'
          ? 'wiki'
          : 'slides';
      results.push({ kind, token, url: m[0] });
    }

    FEISHU_BITABLE_RE.lastIndex = 0;
    while ((m = FEISHU_BITABLE_RE.exec(haystack)) !== null) {
      const appToken = m[1] ?? '';
      const suffix = m[2] ?? '';
      const tableId = /[?&]table=([A-Za-z0-9_-]+)/.exec(suffix)?.[1] ?? '';
      if (!appToken || seen.has(appToken) || !tableId) continue;
      seen.add(appToken);
      results.push({ kind: 'bitable', appToken, tableId, url: m[0] });
    }
  }

  return results.slice(0, 5); // limit API calls
}

async function fetchLinkedContent(
  messages: readonly Message[],
  ctx: SkillContext,
): Promise<ContextItem[]> {
  const urls = parseFeishuUrls(messages);
  ctx.logger.info('qa linked content scan', {
    historyCount: messages.length,
    urlCount: urls.length,
    urls: urls.map((u) =>
      u.kind === 'bitable'
        ? { kind: u.kind, appToken: u.appToken, tableId: u.tableId }
        : { kind: u.kind, token: u.token },
    ),
  });
  if (urls.length === 0) {
    ctx.logger.warn('qa found no Feishu URLs in recent history', {
      samples: messages.slice(0, 5).map((m) => ({
        type: m.contentType,
        text: m.text.slice(0, 120),
        rawContent: m.rawContent.slice(0, 200),
      })),
    });
    return [];
  }

  const items: ContextItem[] = [];
  for (const u of urls) {
    if (u.kind === 'doc' || u.kind === 'wiki' || u.kind === 'slides') {
      const res = await ctx.docx.readContent(u.token, u.kind);
      if (!res.ok) {
        ctx.logger.warn('qa linked doc read failed', {
          kind: u.kind,
          token: u.token,
          code: res.error.code,
          message: res.error.message,
        });
        continue;
      }
      if (!res.value.trim()) {
        ctx.logger.warn('qa linked doc read returned empty content', {
          kind: u.kind,
          token: u.token,
        });
        continue;
      }
      ctx.logger.info('qa linked doc read ok', {
        kind: u.kind,
        token: u.token,
        chars: res.value.length,
      });
      items.push({
        kind: u.kind,
        text: res.value.slice(0, 3000), // cap at 3k chars per doc
        title:
          u.kind === 'doc'
            ? `飞书文档 ${u.token.slice(-6)}`
            : u.kind === 'wiki'
              ? `飞书 Wiki ${u.token.slice(-6)}`
              : `飞书幻灯片 ${u.token.slice(-6)}`,
        url: u.url,
        messageId: u.token,
      });
    } else {
      const res = await ctx.bitable.readTable(u.appToken, u.tableId, 50);
      if (!res.ok) {
        ctx.logger.warn('qa linked bitable read failed', {
          appToken: u.appToken,
          tableId: u.tableId,
          code: res.error.code,
          message: res.error.message,
        });
        continue;
      }
      if (!res.value.trim()) {
        ctx.logger.warn('qa linked bitable read returned empty content', {
          appToken: u.appToken,
          tableId: u.tableId,
        });
        continue;
      }
      ctx.logger.info('qa linked bitable read ok', {
        appToken: u.appToken,
        tableId: u.tableId,
        chars: res.value.length,
      });
      items.push({
        kind: 'bitable',
        text: res.value.slice(0, 3000),
        title: `多维表格 ${u.tableId}`,
        url: u.url,
        messageId: u.appToken,
      });
    }
  }
  return items;
}

export const qaSkill: Skill = {
  name: 'qa',
  metadata: {
    description: '回答被 @ 的项目问题，并尽量引用群历史、文档或表格上下文。',
    when_to_use: '用户 @bot 提问，或明确要求解释项目背景、方案、负责人、进度和资料内容时使用。',
    examples: ['@bot 这个功能怎么用？', '@bot 上次说的技术方案是什么？', '@bot 谁负责演示稿？'],
  },
  trigger: {
    events: ['message'],
    requireMention: true,
    keywords: ['?', '？', '是什么', '怎么', '为什么', '如何', '谁负责', '哪个', '能不能'],
    description: '@bot + 疑问句 → 检索群历史回答',
  },
  match: (ctx) => {
    if (ctx.event.type !== 'message') return false;
    const msg = ctx.event.payload;
    if (!mentionsBot(msg)) return false;
    return QUESTION_PATTERN.test(msg.text);
  },
  run: async (ctx) => {
    const msg = ctx.event.payload as Message;
    const { chatId, text } = msg;

    let contextItems: ContextItem[] = [];
    let usedRetriever = false;

    // Fetch history once — reused for both chat context and URL scanning.
    const historyResult = await ctx.runtime.fetchHistory({ chatId, pageSize: 30 });
    const historyMessages = historyResult.ok ? historyResult.value.messages : [];
    if (!historyResult.ok) {
      ctx.logger.warn('qa history fetch failed', {
        code: historyResult.error.code,
        message: historyResult.error.message,
      });
    }

    const chatRetriever = Object.values(ctx.retrievers).find(
      (r) => r.source === 'chat' || r.source === 'vector',
    );

    if (chatRetriever) {
      const hitsResult = await chatRetriever.retrieve({ query: text, chatId, topK: 5 });
      if (hitsResult.ok) {
        contextItems = hitsResult.value
          .filter((h) => h.snippet.length > 0)
          .map((h) => ({
            kind: h.source === 'vector' ? ('chat' as const) : h.source,
            text: h.snippet,
            title: h.title || '相关群聊记录',
            ...(h.url ? { url: h.url } : {}),
            ...(typeof h.meta?.['authorName'] === 'string'
              ? { authorName: h.meta['authorName'] }
              : {}),
            ...(h.timestamp !== undefined ? { timestamp: h.timestamp } : {}),
            messageId: h.id,
          }));
        usedRetriever = contextItems.length > 0;
      } else {
        ctx.logger.warn('qa retriever failed, falling back to history', {
          code: hitsResult.error.code,
          message: hitsResult.error.message,
        });
      }
    }

    if (contextItems.length === 0 && historyMessages.length > 0) {
      const botOpenId = process.env['LARK_BOT_OPEN_ID'];
      const candidates = historyMessages
        .filter((m) => m.text.length > 0)
        .filter((m) => m.messageId !== msg.messageId)
        .filter((m) => m.text.trim() !== text.trim())
        .filter((m) => m.sender.userId !== botOpenId)
        .map((m) => ({ m, score: bigramScore(m.text, text) }));

      // Sliding window: anchors = bigram matches; expand ±2 positions within 5-min
      // window to capture pronoun-reference messages (e.g. "他" referring to a name).
      const SLIDE = 2;
      const TIME_MS = 5 * 60 * 1000;
      const scores = new Map<number, number>();
      candidates.forEach((c, i) => {
        if (c.score > 0) scores.set(i, c.score);
      });
      for (const [ai, anchorScore] of [...scores.entries()]) {
        const anchor = candidates[ai];
        if (anchor === undefined) continue;
        for (let d = 1; d <= SLIDE; d++) {
          for (const ni of [ai - d, ai + d]) {
            if (ni < 0 || ni >= candidates.length || scores.has(ni)) continue;
            const neighbor = candidates[ni];
            if (neighbor === undefined) continue;
            if (Math.abs(neighbor.m.timestamp - anchor.m.timestamp) <= TIME_MS) {
              scores.set(ni, anchorScore * 0.5 ** d);
            }
          }
        }
      }

      contextItems = [...scores.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .flatMap(([i]) => {
          const c = candidates[i];
          return c !== undefined ? [historyContextItem(c.m)] : [];
        });
    }

    // Scan ALL history messages for Feishu doc/bitable/slide URLs and read their content.
    // Done regardless of whether chat context was found — documents may contain answers
    // even when the share message has no keyword overlap with the question.
    const linkedItems = await fetchLinkedContent(historyMessages, ctx);
    if (linkedItems.length > 0) {
      contextItems = [...linkedItems, ...contextItems];
    }

    // No relevant context found anywhere — bail early without calling LLM.
    if (contextItems.length === 0) {
      return ok({ text: '暂时找不到相关记录，建议直接在群里问一下。' });
    }

    const contextTexts = contextItems.map((item) => `${item.title}\n${item.text}`);
    const answerResult = await ctx.llm.ask(QA_PROMPT(text, contextTexts), { model: 'pro' });
    if (!answerResult.ok) return answerResult;

    const raw = answerResult.value.trim();
    if (raw.includes('INSUFFICIENT_CONTEXT')) {
      return ok({ text: '暂时找不到相关记录，建议直接在群里问一下。' });
    }

    // LLM outputs "SOURCES: 1,3" at the end — parse and strip it.
    const sourcesMatch = /\nSOURCES:\s*([^\n]+)/.exec(raw);
    const answer = raw.replace(/\nSOURCES:[^\n]*/g, '').trim();
    const citedGroup = sourcesMatch?.[1] ?? '';
    const citedItems: ContextItem[] =
      citedGroup !== '' && citedGroup.trim() !== 'none'
        ? citedGroup
            .split(',')
            .map((s) => parseInt(s.trim(), 10) - 1)
            .filter((i) => !isNaN(i) && i >= 0 && i < contextItems.length)
            .flatMap((i) => {
              const item = contextItems[i];
              return item !== undefined ? [item] : [];
            })
        : [];

    const displayItems =
      citedItems.length > 0
        ? citedItems
        : citedGroup.trim() === 'none'
          ? []
          : contextItems.slice(0, 3);

    const sources = displayItems.map((item) => ({
      title: item.title,
      kind: item.kind,
      snippet: item.text.length > 300 ? `${item.text.slice(0, 300)}…` : item.text,
      ...(item.url ? { url: item.url } : {}),
      ...(item.authorName ? { authorName: item.authorName } : {}),
      ...(item.timestamp !== undefined ? { timestamp: item.timestamp } : {}),
      ...(item.messageId ? { messageId: item.messageId } : {}),
    }));

    const card = ctx.cardBuilder.build('qa', {
      question: text,
      answer,
      sources,
      buttons: [
        {
          text: '重新回答',
          value: { action: 'qa.reanswer', questionMessageId: msg.messageId, chatId },
        },
      ],
    });

    return ok({
      card,
      reasoning: usedRetriever
        ? '命中群聊检索结果后由豆包 Pro 合成回答'
        : '未命中检索器，降级读取最近群聊历史后由豆包 Pro 合成回答',
    });
  },
};
