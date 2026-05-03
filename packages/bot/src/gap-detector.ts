/**
 * GapDetector — 信息缺口检测器。
 *
 * 用豆包 Lite 判断一批群消息里是否存在"有人需要某个信息但没找到"的场景。
 * LLM 失败 / 非法 JSON → 返回 shouldRecall: false，不崩。
 */

import { type Result, type LLMClient, type Message, ok } from '@seedhac/contracts';

export interface GapDetection {
  readonly shouldRecall: boolean;
  readonly reason: string;
  readonly query: string;
}

const FALLBACK: GapDetection = { shouldRecall: false, reason: '', query: '' };

function buildPrompt(messages: readonly Message[]): string {
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

export class GapDetector {
  constructor(private readonly llm: LLMClient) {}

  async detect(messages: readonly Message[]): Promise<Result<GapDetection>> {
    if (messages.length === 0) return ok(FALLBACK);

    const prompt = buildPrompt(messages);
    const result = await this.llm.ask(prompt, { model: 'lite' });

    if (!result.ok) return ok(FALLBACK);

    try {
      const cleaned = result.value.trim().replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned) as GapDetection;
      return ok({
        shouldRecall: Boolean(parsed.shouldRecall),
        reason: String(parsed.reason ?? ''),
        query: String(parsed.query ?? ''),
      });
    } catch {
      return ok(FALLBACK);
    }
  }
}
