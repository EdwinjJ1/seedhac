/**
 * M3 — LLM 工具处理器
 *
 * 4 个供 chatWithTools 调用的工具：
 *   memory.read   按 (kind, key) 精确读取单条记忆
 *   memory.search 按 chat_id + 关键词模糊检索记忆
 *   skill.list    列出所有 Skill 名称与一句话描述
 *   skill.read    返回指定 Skill 的 docs/bot-memory/skills/<name>.md 全文
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { LLMTool, ToolCall, ToolResult } from '@seedhac/contracts';
import type { MemoryKind } from '@seedhac/contracts';
import { skills } from '@seedhac/skills';

import type { MemoryStore } from './memory-store.js';
import { truncateToBytes } from './text-utils.js';

// ─── 工具描述（JSON Schema 子集）────────────────────────────────────────────────

const TOOLS: readonly LLMTool[] = [
  {
    name: 'memory.read',
    description: '按 kind + key 精确读取当前群组的一条记忆记录',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['project', 'chat', 'user', 'skill_log'],
          description: '记忆类型',
        },
        key: { type: 'string', description: '幂等键，同 (kind, key) 唯一定位一条记忆' },
      },
      required: ['kind', 'key'],
    },
  },
  {
    name: 'memory.search',
    description: '在当前群组记忆中按关键词模糊检索，返回最相关的若干条记录',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词或自然语言描述' },
        limit: { type: 'number', minimum: 1, maximum: 10, description: '返回条数，默认 5' },
      },
      required: ['query'],
    },
  },
  {
    name: 'skill.list',
    description: '列出所有已注册 Skill 的名称和一句话描述',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'skill.read',
    description: '获取指定 Skill 的完整行为规范文档（≤ 2KB）',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill 名称，如 recall / summary / archive' },
      },
      required: ['name'],
    },
  },
];

/** 返回供 chatWithTools 使用的工具列表 */
export function getLLMTools(): LLMTool[] {
  return [...TOOLS];
}

// ─── 日志接口（与 SkillContext.logger 对齐）──────────────────────────────────────

export interface ToolLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
}

// ─── 工具执行器 ─────────────────────────────────────────────────────────────────

export interface ExecutorDeps {
  readonly store: MemoryStore;
  /** 当前群组 ID，memory.read 的隐式上下文 */
  readonly chatId: string;
  readonly logger: ToolLogger;
  /** docs/bot-memory 目录绝对路径 */
  readonly docsRoot: string;
  /** 可注入的文件读取函数，便于测试 mock */
  readonly readFileFn?: (path: string) => Promise<string>;
}

/**
 * 工厂：返回 chatWithTools 的 executor 函数。
 * 每次工具调用都打 info 日志（tool name + args + 耗时）。
 */
export function makeExecutor(deps: ExecutorDeps): (call: ToolCall) => Promise<ToolResult> {
  const readFileFn = deps.readFileFn ?? ((p: string) => readFile(p, 'utf-8'));

  return async (call: ToolCall): Promise<ToolResult> => {
    const start = Date.now();

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.argumentsRaw) as Record<string, unknown>;
    } catch {
      return result(call, JSON.stringify({ error: 'invalid JSON in tool arguments' }));
    }

    const content = await dispatch(call.name, args, deps, readFileFn);
    const ms = Date.now() - start;

    deps.logger.info('tool called', { tool: call.name, args, ms });
    return result(call, content);
  };
}

function result(call: ToolCall, content: string): ToolResult {
  return { toolCallId: call.id, name: call.name, content };
}

// ─── 分发 ──────────────────────────────────────────────────────────────────────

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  deps: ExecutorDeps,
  readFileFn: (path: string) => Promise<string>,
): Promise<string> {
  switch (name) {
    case 'memory.read':
      return handleMemoryRead(args, deps);
    case 'memory.search':
      return handleMemorySearch(args, deps);
    case 'skill.list':
      return handleSkillList();
    case 'skill.read':
      return handleSkillRead(args, deps.docsRoot, readFileFn);
    default:
      return JSON.stringify({ error: `unknown tool: ${name}` });
  }
}

// ─── 各 handler ────────────────────────────────────────────────────────────────

async function handleMemoryRead(
  args: Record<string, unknown>,
  deps: ExecutorDeps,
): Promise<string> {
  const kind = String(args['kind'] ?? '') as MemoryKind;
  const key = String(args['key'] ?? '');

  if (!kind || !key) return JSON.stringify({ error: 'kind and key are required' });

  const r = await deps.store.read(kind, deps.chatId, key);
  if (!r.ok) return JSON.stringify({ error: r.error.message });
  if (r.value === null) return JSON.stringify({ found: false });
  return JSON.stringify({ found: true, record: r.value });
}

async function handleMemorySearch(
  args: Record<string, unknown>,
  deps: ExecutorDeps,
): Promise<string> {
  const chatId = deps.chatId; // 不信任 LLM 传入的 chat_id，强制用会话上下文（R2）
  const query = String(args['query'] ?? '');
  const limit = typeof args['limit'] === 'number' ? Math.min(args['limit'], 10) : 5;

  if (!query) return JSON.stringify({ error: 'query is required' });

  const r = await deps.store.search(chatId, query, { limit });
  if (!r.ok) return JSON.stringify({ error: r.error.message });
  return JSON.stringify({ records: r.value });
}

function handleSkillList(): string {
  const list = skills.map((s) => ({ name: s.name, description: s.trigger.description }));
  return JSON.stringify({ skills: list });
}

const SKILL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;
const MAX_SKILL_DOC_BYTES = 2 * 1024;

async function handleSkillRead(
  args: Record<string, unknown>,
  docsRoot: string,
  readFileFn: (path: string) => Promise<string>,
): Promise<string> {
  const name = String(args['name'] ?? '');

  if (!SKILL_NAME_RE.test(name)) return JSON.stringify({ error: 'invalid skill name' });

  const filePath = resolve(docsRoot, 'skills', `${name}.md`);
  // 防止路径穿越：确认在 docsRoot 内
  if (!filePath.startsWith(resolve(docsRoot))) {
    return JSON.stringify({ error: 'access denied' });
  }

  let content: string;
  try {
    content = await readFileFn(filePath);
  } catch {
    return JSON.stringify({ error: `skill "${name}" document not found` });
  }

  // 控制在 2KB 内，避免撑爆上下文；truncateToBytes 保证不撕裂多字节字符
  return truncateToBytes(content, MAX_SKILL_DOC_BYTES);
}
