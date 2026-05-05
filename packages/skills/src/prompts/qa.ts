export const QA_PROMPT = (question: string, context: readonly string[]): string => {
  const items = context.slice(0, 10);
  const numbered = items.map((c, i) => `[${i + 1}] ${c}`).join('\n');
  return `你是一个项目协作助手，熟悉团队的历史讨论。根据以下上下文回答问题。
如果上下文不足以回答，输出"INSUFFICIENT_CONTEXT"（不要解释）。
回答简洁，2-4句话即可。回答结尾另起一行，输出你实际引用的来源编号：
SOURCES: 1,3（逗号分隔；未引用任何来源则输出 SOURCES: none）

上下文：
${numbered}

问题：${question}`;
};
