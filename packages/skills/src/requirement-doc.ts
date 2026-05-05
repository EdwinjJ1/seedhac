/**
 * requirementDoc — 需求文档自动生成
 *
 * 触发：被动监听，群里出现项目需求描述时自动整理成结构化飞书文档
 * 数据流：
 *   群历史消息 (+ 命中的飞书 doc/wiki 正文) → LLM 结构化提取
 *   → 创建飞书文档 → 推 docPush 卡片 → 存入 memory
 *
 * 真实输入形态都覆盖：
 *   1) 单条消息直接说需求
 *   2) 多轮对话逐步澄清
 *   3) 群里只发了一个文档链接（真实需求在文档里）
 *   4) 上述组合
 */

import type { Message, Skill, SkillContext } from '@seedhac/contracts';
import { err, ok } from '@seedhac/contracts';
import {
  REQ_PROMPT,
  RELEVANCE_PROMPT,
  RelevanceJudgmentSchema,
  RequirementDocSchema,
  renderRequirementDocMarkdown,
  parseFeishuDocUrls,
  type LinkedDocSnippet,
  type RelevanceCandidate,
} from './prompts/requirement-doc.js';

// 与 packages/bot/src/skill-router.ts 的 requirementDoc 规则保持同步：
//   - 「项目」与「需求」中间最多隔 3 字，覆盖「项目的需求 / 项目本次需求」
//   - 「以下是 / 以上是 / 下面是 / 上面是 ... 需求」
//   - 「这是 / 这就是 ... 项目」
//   - 显式段落标题「项目背景 / 项目目标 / 项目范围」
const TRIGGER_RE =
  /项目.{0,3}需求|需求文档|功能需求|产品需求|PRD|(?:以下|以上|下面|上面)是?.{0,12}需求|这(?:就)?是.{0,8}项目|项目(?:背景|目标|范围)/i;

/**
 * 把历史消息里的「合并转发」展开：调 runtime.fetchMessage 拿父 + 嵌套子，
 * 用嵌套子（仅文本）替换掉父消息原位。失败时保留父原样并 logger.warn。
 */
async function expandMergeForward(
  ctx: SkillContext,
  history: readonly Message[],
): Promise<readonly Message[]> {
  // 诊断：打印 fetchHistory 拿回来的每条消息的 contentType + text 前缀，
  // 排查「为什么 merge_forward 进了 history 却没被 expandMergeForward 命中」。
  ctx.logger.info('requirementDoc: scanning history for merge_forward', {
    count: history.length,
    summary: history.map((m) => ({
      mid: m.messageId.slice(-8),
      contentType: m.contentType,
      textHead: m.text.slice(0, 30),
      rawContentHead: (m.rawContent ?? '').slice(0, 30),
    })),
  });

  const out: Message[] = [];
  for (const m of history) {
    if ((m.contentType as string) !== 'merge_forward') {
      out.push(m);
      continue;
    }
    ctx.logger.info('requirementDoc: expanding merge_forward', { messageId: m.messageId });
    const fetched = await ctx.runtime.fetchMessage(m.messageId);
    if (!fetched.ok) {
      ctx.logger.warn('requirementDoc: fetchMessage failed for merge_forward; keeping as-is', {
        messageId: m.messageId,
        code: fetched.error.code,
        message: fetched.error.message,
      });
      out.push(m);
      continue;
    }
    // fetched.messages: 第 1 条是父（merge_forward 自身），后面是平铺的嵌套子。
    const children = fetched.value.messages.filter(
      (c) => (c.contentType as string) === 'text' && c.text.trim().length > 0,
    );
    if (children.length === 0) {
      ctx.logger.warn('requirementDoc: merge_forward had no text children; keeping as-is', {
        messageId: m.messageId,
      });
      out.push(m);
      continue;
    }
    ctx.logger.info('requirementDoc: merge_forward expanded', {
      messageId: m.messageId,
      childCount: children.length,
    });
    out.push(...children);
  }
  return out;
}

function summarize(value: string, max = 200): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

async function filterByRelevance(
  ctx: SkillContext,
  trigger: Message,
  history: readonly Message[],
  linkedDocs: readonly LinkedDocSnippet[],
): Promise<{ history: readonly Message[]; linkedDocs: readonly LinkedDocSnippet[] }> {
  // 关键产品判断：linkedDocs 是用户**主动贴进来 / 转发过来**的飞书文档，
  // 已经是显式输入信号 —— 不应让 lite 模型「猜要不要保留」。否则会出现：
  // 群里凑巧有别项目的历史多，lite 把"用户当下贴的文档"判为无关全丢掉，
  // 主提取看不到文档内容，PRD 完全跑偏（实测就发生过：跨境电商 wiki 被丢，
  // 输出变成了 K12 备课助手）。
  // 因此：linkedDocs 100% keep；只对历史消息做 lite 相关性预筛。
  if (history.length === 0) {
    return { history, linkedDocs };
  }

  const candidates: RelevanceCandidate[] = history.map((m, i) => ({
    id: `m${i}`,
    kind: 'message',
    excerpt: `[${m.sender.name ?? m.sender.userId}] ${summarize(m.text, 200)}`,
  }));

  ctx.logger.info('requirementDoc: relevance pre-filter (history only; linkedDocs always kept)', {
    historyCount: history.length,
    linkedDocCount: linkedDocs.length,
  });

  const judgmentResult = await ctx.llm.askStructured(
    RELEVANCE_PROMPT(trigger.text, candidates),
    RelevanceJudgmentSchema,
    { model: 'lite', timeoutMs: 30_000 },
  );

  if (!judgmentResult.ok) {
    // 预筛挂掉不致命，退回到全量喂给主 LLM。主 prompt 自身也对噪音有一定鲁棒性。
    ctx.logger.warn('requirementDoc: relevance filter failed, falling back to full context', {
      code: judgmentResult.error.code,
      message: judgmentResult.error.message,
    });
    return { history, linkedDocs };
  }

  // 边界保护 1：LLM 没给出任何 results（解析失败或模型懒回应）→ 退化到不过滤。
  if (judgmentResult.value.results.length === 0) {
    ctx.logger.warn('requirementDoc: relevance filter returned empty, skipping filter');
    return { history, linkedDocs };
  }

  const keepIds = new Set(judgmentResult.value.results.filter((r) => r.keep).map((r) => r.id));
  const keptHistory = history.filter((_, i) => keepIds.has(`m${i}`));

  ctx.logger.info('requirementDoc: relevance pre-filter done', {
    historyKept: `${keptHistory.length}/${history.length}`,
    linkedDocKept: `${linkedDocs.length}/${linkedDocs.length} (always kept)`,
  });

  // 边界保护 2：LLM 极端地把所有历史都丢了 —— 至少把 linkedDocs 留下当主体。
  if (keptHistory.length === 0 && linkedDocs.length > 0) {
    ctx.logger.warn('requirementDoc: relevance filter dropped all history, proceeding with linkedDocs only');
  }

  return { history: keptHistory, linkedDocs };
}

async function fetchLinkedDocs(
  ctx: SkillContext,
  messages: readonly Message[],
): Promise<LinkedDocSnippet[]> {
  const urls = parseFeishuDocUrls(messages);
  if (urls.length === 0) return [];

  ctx.logger.info('requirementDoc: found feishu doc/wiki links in history', {
    count: urls.length,
    samples: urls.map((u) => ({ kind: u.kind, token: u.token })),
  });

  const snippets: LinkedDocSnippet[] = [];
  for (const u of urls) {
    const res = await ctx.docx.readContent(u.token, u.kind);
    if (!res.ok) {
      ctx.logger.warn('requirementDoc: linked doc read failed', {
        kind: u.kind,
        token: u.token,
        code: res.error.code,
        message: res.error.message,
      });
      continue;
    }
    const trimmed = res.value.trim();
    if (!trimmed) {
      ctx.logger.warn('requirementDoc: linked doc empty', { kind: u.kind, token: u.token });
      continue;
    }
    snippets.push({ kind: u.kind, url: u.url, content: trimmed });
  }
  return snippets;
}

export const requirementDocSkill: Skill = {
  name: 'requirementDoc',
  trigger: {
    events: ['message'],
    requireMention: false,
    keywords: ['项目需求', '需求文档', 'PRD', '产品需求', '项目背景'],
    description: '检测到需求描述时自动生成结构化飞书文档（支持单条 / 多轮 / 文档链接 / 组合）',
  },
  match: (ctx) => {
    if (ctx.event.type !== 'message') return false;
    return TRIGGER_RE.test(ctx.event.payload.text);
  },
  run: async (ctx) => {
    if (ctx.event.type !== 'message') {
      return ok({ text: '' });
    }
    const msg = ctx.event.payload as Message;
    const chatId = msg.chatId;

    // a. 拉最近 20 条历史
    ctx.logger.info('requirementDoc: fetching chat history', { chatId });
    const historyResult = await ctx.runtime.fetchHistory({ chatId, pageSize: 20 });
    if (!historyResult.ok) return err(historyResult.error);
    const historyRaw = historyResult.value.messages;

    // a2. 展开「合并转发」消息（merge_forward）：原始内容嵌在父 messageId 的子项里，
    //     不展开的话用户转发的整段 K12 备课助手讨论会被当成一行 "Merged and Forwarded
    //     Message" 噪音，bot 完全看不到真实内容。
    const historyAll = await expandMergeForward(ctx, historyRaw);

    // a3. 抽取并读取群里出现的飞书文档
    const linkedDocsAll = await fetchLinkedDocs(ctx, historyAll);

    // b. LLM 预筛：判断每条历史 / 每篇文档与触发消息是否相关
    //    群里可能掺杂多个项目的讨论，不预筛会让 PRD 把无关内容混进来。
    const { history, linkedDocs } = await filterByRelevance(ctx, msg, historyAll, linkedDocsAll);

    // c. LLM 结构化提取（history + linkedDocs 都喂给模型）
    ctx.logger.info('requirementDoc: asking LLM for structured extraction', {
      historyCount: history.length,
      linkedDocCount: linkedDocs.length,
    });
    const docResult = await ctx.llm.askStructured(
      REQ_PROMPT(history, linkedDocs),
      RequirementDocSchema,
      // pro 模型默认超时 30s 不够：拉了 20 条历史 + 可能附带几篇文档正文，
      // prompt 偏长，跑到 35–45s 是常态。给 90s 与 slides skill 对齐。
      { model: 'pro', timeoutMs: 90_000 },
    );
    if (!docResult.ok) return err(docResult.error);
    const doc = docResult.value;

    // d. 序列化 markdown + 创建飞书文档
    const markdown = renderRequirementDocMarkdown(doc);
    ctx.logger.info('requirementDoc: creating feishu doc', {
      title: doc.title,
      goalCount: doc.goals.length,
      deliverableCount: doc.deliverables.length,
    });
    const fileResult = await ctx.docx.createFromMarkdown(doc.title, markdown);
    if (!fileResult.ok) return err(fileResult.error);

    // e. 写 memory（失败仅 warn，不阻断卡片输出）
    const memRes = await ctx.bitable.insert({
      table: 'memory',
      row: {
        chatId,
        type: 'requirement',
        docToken: fileResult.value.docToken,
        content: doc.title,
        timestamp: Date.now(),
      },
    });
    if (!memRes.ok) {
      ctx.logger.warn('requirementDoc: insert memory failed', {
        code: memRes.error.code,
        message: memRes.error.message,
      });
    }

    // f. 推 docPush 卡片
    const card = ctx.cardBuilder.build('docPush', {
      docTitle: doc.title,
      docUrl: fileResult.value.url,
      docType: 'requirement',
      summary: `已整理 ${doc.goals.length} 个目标、${doc.deliverables.length} 个交付物${
        linkedDocs.length ? `（参考了 ${linkedDocs.length} 篇关联文档）` : ''
      }`,
    });

    return ok({
      card,
      reasoning: `检测到需求描述，基于 ${history.length} 条群聊记录${
        linkedDocs.length ? ` + ${linkedDocs.length} 篇关联文档` : ''
      }生成需求文档「${doc.title}」`,
    });
  },
};
