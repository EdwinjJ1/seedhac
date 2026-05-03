import type { Message } from '@seedhac/contracts';

export interface SummaryExtraction {
  readonly decisions: readonly string[];
  readonly actionItems: readonly { owner: string; content: string; ddl?: string }[];
  readonly issues: readonly string[];
  readonly nextSteps: readonly string[];
}

export const EMPTY_EXTRACTION: SummaryExtraction = {
  decisions: [],
  actionItems: [],
  issues: [],
  nextSteps: [],
};

export function SUMMARY_PROMPT(history: readonly Message[]): string {
  const lines = history.map((m) => `[${m.sender.name ?? m.sender.userId}]: ${m.text}`).join('\n');

  return `整理以下群聊记录中的会议内容，提取以下字段：
- decisions：本次会议的决策列表（字符串数组）
- actionItems：行动项列表，每项包含 owner（负责人）、content（内容）、ddl（截止日期，无则省略）
- issues：遗留问题列表（字符串数组）
- nextSteps：下一步计划列表（字符串数组）

只返回如下 JSON，不要有额外文字：
{"decisions":[],"actionItems":[{"owner":"","content":"","ddl":""}],"issues":[],"nextSteps":[]}

群聊记录：
${lines}`;
}
