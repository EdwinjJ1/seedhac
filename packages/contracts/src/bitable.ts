/**
 * 飞书多维表格客户端契约。
 *
 * Bitable 在我们这套架构里承担：Memory / 决策 / 待办 / 知识图谱（双向关联字段）的存储。
 * 限制（CLAUDE.md）：10 QPS、单批 ≤ 500 条、批量操作全成功或全失败。
 *
 * 行类型当前用宽松的 Record<string, unknown>，待 Bitable 表 schema 实建后收紧
 * （收紧不算"改契约"，算"补全"）。
 */

import type { Result } from './result.js';

/** 4 张核心表 — 与 docs/技术栈与可复用能力.md 第四节对齐 */
export type BitableTableKind = 'memory' | 'decision' | 'todo' | 'knowledge';

/**
 * Memory 表行的强类型 schema（M2 引入）。
 * MemoryStore 写入时按此结构校验，读取时按此类型反序列化。
 */
export type MemoryKind = 'project' | 'chat' | 'user' | 'skill_log';

export interface MemoryRecord {
  readonly id?: string;
  readonly kind: MemoryKind;
  readonly chat_id: string;
  readonly user_id?: string;
  readonly key: string;
  readonly content: string;
  readonly importance: number;
  readonly last_access: number;
  readonly created_at: number;
  readonly source_skill: string;
}

/** 写入时的输入：id / created_at / last_access / importance 由 store 自动管理 */
export type MemoryWriteInput = Pick<
  MemoryRecord,
  'kind' | 'chat_id' | 'key' | 'content' | 'source_skill'
> & {
  readonly user_id?: string;
  readonly importance?: number;
};

/** 通用行：开发期用 Record，后续按 TableKind 收紧到具体类型 */
export type BitableRow = Record<string, unknown>;

/** 一条记录的稳定主键（飞书侧的 record_id） */
export interface RecordRef {
  readonly tableId: string;
  readonly recordId: string;
}

export interface FindParams {
  readonly table: BitableTableKind;
  /** 简单等值查询；复杂查询走 filter */
  readonly where?: Record<string, unknown>;
  /** 飞书 filter 表达式（透传） */
  readonly filter?: string;
  readonly pageSize?: number;
  readonly pageToken?: string;
}

export interface FindResult {
  readonly records: readonly (BitableRow & RecordRef)[];
  readonly hasMore: boolean;
  readonly nextPageToken?: string;
}

export interface InsertParams {
  readonly table: BitableTableKind;
  readonly row: BitableRow;
}

export interface BatchInsertParams {
  readonly table: BitableTableKind;
  readonly rows: readonly BitableRow[];
  /** 单次批量上限，飞书硬上限 500 */
  readonly batchSize?: number;
}

export interface UpdateParams {
  readonly table: BitableTableKind;
  readonly recordId: string;
  readonly patch: BitableRow;
}

export interface DeleteParams {
  readonly table: BitableTableKind;
  readonly recordId: string;
}

/** 双向关联字段操作 — 知识图谱 1-2 跳关系 */
export interface LinkParams {
  readonly fromTable: BitableTableKind;
  readonly fromRecordId: string;
  readonly fieldName: string;
  readonly toTable: BitableTableKind;
  readonly toRecordIds: readonly string[];
}

export interface BitableClient {
  find(params: FindParams): Promise<Result<FindResult>>;
  insert(params: InsertParams): Promise<Result<RecordRef>>;
  batchInsert(params: BatchInsertParams): Promise<Result<readonly RecordRef[]>>;
  update(params: UpdateParams): Promise<Result<void>>;
  delete(params: DeleteParams): Promise<Result<void>>;
  link(params: LinkParams): Promise<Result<void>>;
  /** 读取任意多维表格内容并序列化为字符串（qa skill 用于读取群聊中链接的外部 Bitable） */
  readTable(appToken: string, tableId: string, maxRows?: number): Promise<Result<string>>;
}
