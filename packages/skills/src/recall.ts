/**
 * recall — 主动浮信息（核心差异化）
 *
 * 触发：群消息中出现模糊表述 → 豆包 Lite 判断是否存在信息缺口
 * 数据流：keyword 预筛 → 拉近期消息 → 缺口检测 → 并行检索（vector + bitable）→ LLM 整合 → 纯文本回复
 *
 * 注意：卡片规范里 recall 直接返回 SkillResult.text，像同事随口一句话。
 */

import {
  type Skill,
  type SkillContext,
  type SkillResult,
  type RetrieveQuery,
  type RetrieveHit,
  type LLMClient,
  type Message,
  type Result,
  ok,
  err,
  makeError,
  ErrorCode,
} from '@seedhac/contracts';

const KEYWORDS = ['上次', '之前', '我记得', '那个', '上回', '是多少来着'] as const;

interface GapDetection {
  readonly shouldRecall: boolean;
  readonly reason: string;
  readonly query: string;
}

const NO_GAP: GapDetection = { shouldRecall: false, reason: '', query: '' };

function buildGapPrompt(messages: readonly Message[]): string {
  const lines = messages.map((m) => `[${m.sender.name ?? m.sender.userId}]: ${m.text}`).join('\n');

  return `你是一个群聊信息缺口检测助手。

请判断下面这段群聊记录中，是否存在"有人在寻找某个信息但没有得到答案"的情况。

触发条件（满足任一即可）：
1. 不确定性表述：「那个...」「上次...」「是多少来着」「我记得好像」
2. 任务型讨论：涉及「决定 / 方案 / 计划」但缺少具体数据
3. 有人提问但后续没人回答
4. 当前话题与某段历史记录明显相关但没人提起

群聊记录：
${lines}

请只返回如下 JSON，不要有任何其他文字：
{"shouldRecall":true,"reason":"简短说明触发原因","query":"用于检索的关键词或问题"}

如果不需要召回，返回：
{"shouldRecall":false,"reason":"","query":""}`;
}

async function detectGap(llm: LLMClient, messages: readonly Message[]): Promise<GapDetection> {
  const result = await llm.ask(buildGapPrompt(messages), { model: 'lite' });
  if (!result.ok) return NO_GAP;
  try {
    const cleaned = result.value.trim().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned) as GapDetection;
    return {
      shouldRecall: Boolean(parsed.shouldRecall),
      reason: String(parsed.reason ?? ''),
      query: String(parsed.query ?? ''),
    };
  } catch {
    return NO_GAP;
  }
}

async function synthesize(llm: LLMClient, query: string, hits: readonly RetrieveHit[]): Promise<string> {
  const snippets = hits.map((h, i) => `[${i + 1}] ${h.snippet}`).join('\n\n');
  const prompt = `你是群聊助手，请根据历史消息帮忙回答。

查询：${query}

相关历史消息：
${snippets}

请用 1-3 句话，以自然口语化的方式回答，像熟悉项目的同事随口提醒。直接说内容，不要说"根据历史记录"。`;

  const result = await llm.ask(prompt, { model: 'pro' });
  if (!result.ok) return hits[0]?.snippet ?? '';
  return result.value;
}

class RecallSkill implements Skill {
  readonly name = 'recall' as const;
  readonly trigger = {
    events: ['message'] as const,
    requireMention: false,
    keywords: KEYWORDS,
    description: '群消息出现模糊表述 → 主动召回历史信息（事中介入）',
  };

  private readonly gapCache = new Map<string, GapDetection>();
  private static readonly GAP_CACHE_MAX = 200;

  async match(ctx: SkillContext): Promise<boolean> {
    if (ctx.event.type !== 'message') return false;
    const msg = ctx.event.payload;

    if (!KEYWORDS.some((k) => msg.text.includes(k))) return false;

    const histResult = await ctx.runtime.fetchHistory({ chatId: msg.chatId, pageSize: 10 });
    const messages = histResult.ok ? histResult.value.messages : [msg];

    const detection = await detectGap(ctx.llm, messages);
    if (detection.shouldRecall) {
      if (this.gapCache.size >= RecallSkill.GAP_CACHE_MAX) {
        this.gapCache.delete(this.gapCache.keys().next().value!);
      }
      this.gapCache.set(msg.messageId, detection);
    }
    return detection.shouldRecall;
  }

  async run(ctx: SkillContext): Promise<Result<SkillResult>> {
    if (ctx.event.type !== 'message') {
      return err(makeError(ErrorCode.INVALID_INPUT, 'recall only handles message events'));
    }
    const msg = ctx.event.payload;

    let detection = this.gapCache.get(msg.messageId);
    this.gapCache.delete(msg.messageId);

    if (!detection) {
      const histResult = await ctx.runtime.fetchHistory({ chatId: msg.chatId, pageSize: 10 });
      const messages = histResult.ok ? histResult.value.messages : [msg];
      detection = await detectGap(ctx.llm, messages);
      if (!detection.shouldRecall) return ok({ text: '' });
    }

    const query: RetrieveQuery = { query: detection.query, chatId: msg.chatId, topK: 5 };

    const [vectorResult, bitableResult] = await Promise.all([
      ctx.retrievers['vector']?.retrieve(query) ?? Promise.resolve(ok([] as readonly RetrieveHit[])),
      ctx.retrievers['bitable']?.retrieve(query) ?? Promise.resolve(ok([] as readonly RetrieveHit[])),
    ]);

    const hits: RetrieveHit[] = [
      ...(vectorResult.ok ? vectorResult.value : []),
      ...(bitableResult.ok ? bitableResult.value : []),
    ];

    if (hits.length === 0) return ok({ text: '' });

    const text = await synthesize(ctx.llm, detection.query, hits);
    return ok({ text, reasoning: detection.reason });
  }
}

export const recallSkill: Skill = new RecallSkill();
