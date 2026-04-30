/**
 * 检索器接口 — 给 Skill Router 用。
 *
 * 数据源：Wiki / Bitable / 群历史 / 妙记 / Chroma 向量库。
 * 每种数据源各自实现 Retriever，Router 根据 LLM 输出的 sources 字段并行调多个。
 */

import type { Result } from './result.js';

export type RetrieverSource = 'wiki' | 'bitable' | 'chat' | 'minutes' | 'vector';

export interface RetrieveQuery {
  readonly query: string;
  /** 限定检索范围；为空 = 全局 */
  readonly chatId?: string;
  /** 时间窗（Unix ms） */
  readonly startTime?: number;
  readonly endTime?: number;
  readonly topK?: number;
  readonly meta?: Record<string, unknown>;
}

export interface RetrieveHit {
  readonly source: RetrieverSource;
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly url?: string;
  /** 0-1 相关性分数；不同 retriever 评分体系不同，仅供同源排序 */
  readonly score?: number;
  readonly timestamp?: number;
  readonly meta?: Record<string, unknown>;
}

export interface Retriever {
  readonly source: RetrieverSource;
  retrieve(query: RetrieveQuery): Promise<Result<readonly RetrieveHit[]>>;
}
