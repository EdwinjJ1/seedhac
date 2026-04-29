/**
 * LLM 客户端统一接口。
 * 所有 LLM 调用必须走 LLMClient.ask / askStructured，不允许散落 fetch。
 *
 * 模型分流策略（CLAUDE.md 已定）:
 *   - lite (豆包 Lite)：缺口检测、关键词识别、轻量过滤
 *   - pro  (豆包 Pro) ：Skill Router、卡片内容生成、长上下文整合
 */

import type { Result } from './result.js';

export type LLMModel = 'lite' | 'pro';

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface AskOptions {
  readonly model?: LLMModel;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly systemPrompt?: string;
  readonly timeoutMs?: number;
}

/**
 * 极简 schema 描述：实现层用 zod / valibot 都行，contracts 层不绑定具体校验库。
 * 实现 LLMClient 的 adapter 内部把 SchemaLike 转成自己用的校验器。
 */
export interface SchemaLike<T> {
  /** 解析未知值，校验失败抛错 */
  parse(value: unknown): T;
  /** （可选）输出 JSON Schema，给 LLM 做 structured output prompt */
  jsonSchema?(): Record<string, unknown>;
}

export interface LLMClient {
  /** 自由文本问答 */
  ask(prompt: string, opts?: AskOptions): Promise<Result<string>>;

  /** 多轮对话 */
  chat(messages: readonly ChatMessage[], opts?: AskOptions): Promise<Result<string>>;

  /**
   * 结构化输出。实现层应：
   *   1. 把 schema 转成 prompt 提示
   *   2. 调 LLM 拿 raw JSON
   *   3. schema.parse(JSON.parse(raw))
   *   4. 失败重试 N 次后返回 LLM_INVALID_RESPONSE
   */
  askStructured<T>(prompt: string, schema: SchemaLike<T>, opts?: AskOptions): Promise<Result<T>>;
}
