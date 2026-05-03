/**
 * M3 — System Prompt 组装器（Harness 风格）
 *
 * 不在 prompt 里灌完整文档——只告诉模型"项目是什么、有哪些工具、怎么按需调"。
 * 具体 Skill 文档由模型主动调 skill.read 拉取。
 *
 * 使用方式：
 *   const cache = await SystemPromptCache.load(docsRoot);
 *   const prompt = cache.build({ chatId, mention: true });
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { skills } from '@seedhac/skills';

// ─── 工具一句话摘要（与 tool-handlers.ts 的 TOOLS 保持同步）───────────────────

const TOOL_LINES = [
  'memory.read(kind, key)   — 精确读取一条记忆',
  'memory.search(chat_id, query, limit?) — 关键词模糊检索记忆',
  'skill.list()             — 列出所有 Skill 名称与描述',
  'skill.read(name)         — 获取指定 Skill 的完整文档',
];

// ─── 缓存 ───────────────────────────────────────────────────────────────────────

export class SystemPromptCache {
  private constructor(
    private readonly overviewFirstLine: string,
    private readonly skillSummaries: readonly string[],
  ) {}

  /**
   * 启动时调用：读取 OVERVIEW.md 首行（项目定位句）和所有 skills/*.md 首行摘要。
   * 文件缺失时静默降级，不抛错。
   */
  static async load(docsRoot: string): Promise<SystemPromptCache> {
    const overviewFirstLine = await readFirstLine(resolve(docsRoot, 'OVERVIEW.md'));

    const skillSummaries = await Promise.all(
      skills.map(async (s) => {
        const firstLine = await readFirstLine(resolve(docsRoot, 'skills', `${s.name}.md`));
        return firstLine ? `${s.name}: ${firstLine}` : `${s.name}: ${s.trigger.description}`;
      }),
    );

    return new SystemPromptCache(overviewFirstLine, skillSummaries);
  }

  /**
   * 组装最终 system prompt，≤ 2KB。
   * chatId 为空时（极端 case）不崩溃，用占位符代替。
   */
  build({ chatId, mention = false }: { chatId?: string; mention?: boolean }): string {
    const effectiveChatId = chatId ?? '(unknown)';
    const mentionLine = mention ? '用户 @了 Bot，请积极回应。\n' : '';

    const lines = [
      `# Lark Loom — 飞书群聊 AI 助手`,
      this.overviewFirstLine || '群聊上下文感知助手，主动介入信息缺口。',
      '',
      `当前群组：${effectiveChatId}`,
      mentionLine,
      '## 可用工具',
      ...TOOL_LINES.map((l) => `- ${l}`),
      '',
      '## 已注册 Skill',
      ...this.skillSummaries.map((l) => `- ${l}`),
      '',
      '> 需要细节请调 skill.read 或 memory.search，不要凭空推测。',
    ].join('\n');

    return truncateToBytes(lines, 2 * 1024);
  }
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

async function readFirstLine(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath, 'utf-8');
    // 跳过 markdown 标题行（# 开头），取第一个非空非标题行
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) return trimmed;
    }
    return '';
  } catch {
    return '';
  }
}

const TRUNCATE_SUFFIX = '\n…[truncated]';
const TRUNCATE_SUFFIX_BYTES = new TextEncoder().encode(TRUNCATE_SUFFIX).length;

function truncateToBytes(s: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) return s;
  // 预留后缀字节，回退至合法 UTF-8 边界
  const cutTarget = maxBytes - TRUNCATE_SUFFIX_BYTES;
  const strict = new TextDecoder('utf-8', { fatal: true });
  for (let cut = cutTarget; cut >= cutTarget - 3 && cut >= 0; cut--) {
    try {
      return strict.decode(bytes.slice(0, cut)) + TRUNCATE_SUFFIX;
    } catch {
      // 切到多字节字符中间，继续回退
    }
  }
  return s.slice(0, cutTarget) + TRUNCATE_SUFFIX;
}
