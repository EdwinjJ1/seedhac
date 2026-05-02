import type { BitableRow } from '@seedhac/contracts';

export function ARCHIVE_PROMPT(
  memories: readonly BitableRow[],
  decisions: readonly BitableRow[],
  todos: readonly BitableRow[],
): string {
  const doneCount = todos.filter((t) => t['status'] === 'done').length;
  const memorySnippets = memories
    .slice(0, 5)
    .map((m) => String(m['content'] ?? ''))
    .filter(Boolean)
    .join('\n');

  return `根据以下项目记录，写一段 200 字以内的项目总结，包含核心成果、主要决策、遗留问题。语言简练，面向向上汇报。

项目记忆摘要：
${memorySnippets || '（无）'}

关键决策数：${decisions.length}
任务总数：${todos.length}，已完成：${doneCount}

只返回总结文字，不要 JSON，不要标题。`;
}
