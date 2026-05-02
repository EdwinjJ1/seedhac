/**
 * LLM 精排 prompt 模板 — 给 Retriever.search 用。
 *
 * 输入：用户 query + 候选消息列表
 * 输出：JSON 数组，按相关性排序的 messageId 列表
 */

export interface RerankCandidate {
  readonly messageId: string;
  readonly content: string;
  readonly timestamp: number;
}

export function buildRerankPrompt(query: string, candidates: readonly RerankCandidate[]): string {
  const list = candidates
    .map((c, i) => `[${i + 1}] id=${c.messageId}\n${c.content}`)
    .join('\n\n');

  return `你是一个消息相关性排序助手。

用户的查询是：
"${query}"

下面是候选消息列表：
${list}

请从中选出与查询最相关的消息，按相关性从高到低排序，只返回 JSON 数组格式的 messageId 列表，不要包含任何其他文字。
例如：["msg_3","msg_1","msg_7"]

如果没有相关消息，返回空数组：[]`;
}
