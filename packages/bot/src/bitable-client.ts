/**
 * BitableClient 实现 — 飞书多维表格 CRUD adapter。
 *
 * 约束（来自 contracts/bitable.ts 注释 + CLAUDE.md）：
 *   - 10 QPS 限流，超出请求排队，不丢弃
 *   - 批量写入全成功或全失败
 *   - 网络错误最多重试 3 次（1s / 2s / 4s）
 *   - 跨包调用统一返回 Result<T>，不 throw
 */

import * as lark from '@larksuiteoapi/node-sdk';
import {
  type BitableClient,
  type BitableTableKind,
  type BitableRow,
  type RecordRef,
  type FindParams,
  type FindResult,
  type InsertParams,
  type BatchInsertParams,
  type UpdateParams,
  type DeleteParams,
  type LinkParams,
  type Result,
  ok,
  err,
  ErrorCode,
  makeError,
} from '@seedhac/contracts';

// ---------- 内部工具 ----------

const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
const MAX_QPS = 10;
const QPS_WINDOW_MS = 1000;

/**
 * SDK 的 fields 是带 union 的窄类型（多种字段值形态），随 SDK 版本会变。
 * contracts 里 BitableRow = Record<string, unknown> 是宽类型。
 *
 * 边界转换集中在 toLarkFields 里：用 unknown 跳板把宽类型断言成 SDK 期望的窄类型，
 * 类型擦除范围只限于这一处函数。下游调用点都用 toLarkFields 而不是散布 as any。
 *
 * SDK 的 create 是函数重载（v1+v2），不能用 Parameters<> 反射拿 fields 类型；
 * 所以用 InferFields 借 SDK 的实参契约（不是反射，是结构契约）。
 * 待 contracts 的 BitableRow 按 TableKind 收紧后，可以删掉这个工具。
 */
type CreateArg = Parameters<lark.Client['bitable']['appTableRecord']['create']>[0];
type LarkFields = CreateArg extends { data: { fields: infer F } } ? F : never;

function toLarkFields(row: BitableRow): LarkFields {
  return row as unknown as LarkFields;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(RETRY_DELAYS_MS[attempt] ?? 1000);
    }
  }
  throw lastErr;
}

/** 滑动窗口限流器：保证每秒不超过 MAX_QPS 个请求，超出的排队等待 */
class RateLimiter {
  private readonly timestamps: number[] = [];
  private readonly queue: Array<() => void> = [];
  private processing = false;

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      if (!this.processing) void this.drain();
    });
  }

  private async drain(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const now = Date.now();
      // 移除窗口外的旧记录
      while (this.timestamps.length > 0 && now - this.timestamps[0]! >= QPS_WINDOW_MS) {
        this.timestamps.shift();
      }
      if (this.timestamps.length < MAX_QPS) {
        this.timestamps.push(now);
        this.queue.shift()!();
      } else {
        const waitMs = QPS_WINDOW_MS - (now - this.timestamps[0]!) + 1;
        await sleep(waitMs);
      }
    }
    this.processing = false;
  }
}

// ---------- 配置 ----------

export interface BitableConfig {
  readonly appId: string;
  readonly appSecret: string;
  readonly appToken: string;
  readonly tableIds: Record<BitableTableKind, string>;
}

// ---------- 实现 ----------

export class LarkBitableClient implements BitableClient {
  private readonly larkClient: lark.Client;
  private readonly limiter = new RateLimiter();

  constructor(private readonly config: BitableConfig) {
    this.larkClient = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
    });
  }

  private tid(kind: BitableTableKind): string {
    return this.config.tableIds[kind];
  }

  /** 每次飞书 API 调用都经过限流 + 重试 */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    await this.limiter.acquire();
    return withRetry(fn);
  }

  async find(params: FindParams): Promise<Result<FindResult>> {
    const tableId = this.tid(params.table);
    try {
      const res = await this.call(() =>
        this.larkClient.bitable.appTableRecord.list({
          path: { app_token: this.config.appToken, table_id: tableId },
          params: {
            page_size: params.pageSize ?? 20,
            ...(params.pageToken !== undefined && { page_token: params.pageToken }),
            ...(params.filter !== undefined && { filter: params.filter }),
          },
        }),
      );

      if (!res.data) {
        return err(makeError(ErrorCode.FEISHU_API_ERROR, 'find: empty response'));
      }

      const records = (res.data.items ?? []).map((item) => ({
        ...((item.fields ?? {}) as BitableRow),
        tableId,
        recordId: item.record_id ?? '',
      }));

      return ok({
        records,
        hasMore: res.data.has_more ?? false,
        ...(res.data.page_token !== undefined && { nextPageToken: res.data.page_token }),
      });
    } catch (e) {
      return err(makeError(ErrorCode.FEISHU_API_ERROR, 'find failed', e));
    }
  }

  async insert(params: InsertParams): Promise<Result<RecordRef>> {
    const tableId = this.tid(params.table);
    try {
      const res = await this.call(() =>
        this.larkClient.bitable.appTableRecord.create({
          path: { app_token: this.config.appToken, table_id: tableId },
          data: { fields: toLarkFields(params.row) },
        }),
      );

      const recordId = res.data?.record?.record_id;
      if (!recordId) {
        return err(makeError(ErrorCode.FEISHU_API_ERROR, 'insert: no record_id returned'));
      }

      return ok({ tableId, recordId });
    } catch (e) {
      return err(makeError(ErrorCode.FEISHU_API_ERROR, 'insert failed', e));
    }
  }

  async batchInsert(params: BatchInsertParams): Promise<Result<readonly RecordRef[]>> {
    const tableId = this.tid(params.table);
    const chunkSize = Math.min(params.batchSize ?? 500, 500);
    const rows = [...params.rows];
    const results: RecordRef[] = [];

    try {
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const res = await this.call(() =>
          this.larkClient.bitable.appTableRecord.batchCreate({
            path: { app_token: this.config.appToken, table_id: tableId },
            data: {
              records: chunk.map((row) => ({ fields: toLarkFields(row) })),
            },
          }),
        );

        if (!res.data?.records) {
          return err(makeError(ErrorCode.FEISHU_API_ERROR, 'batchInsert: no records returned'));
        }

        for (const record of res.data.records) {
          results.push({ tableId, recordId: record.record_id ?? '' });
        }
      }

      return ok(results);
    } catch (e) {
      return err(makeError(ErrorCode.FEISHU_API_ERROR, 'batchInsert failed', e));
    }
  }

  async update(params: UpdateParams): Promise<Result<void>> {
    const tableId = this.tid(params.table);
    try {
      await this.call(() =>
        this.larkClient.bitable.appTableRecord.update({
          path: {
            app_token: this.config.appToken,
            table_id: tableId,
            record_id: params.recordId,
          },
          data: { fields: toLarkFields(params.patch) },
        }),
      );
      return ok(undefined);
    } catch (e) {
      return err(makeError(ErrorCode.FEISHU_API_ERROR, 'update failed', e));
    }
  }

  async delete(params: DeleteParams): Promise<Result<void>> {
    const tableId = this.tid(params.table);
    try {
      await this.call(() =>
        this.larkClient.bitable.appTableRecord.delete({
          path: {
            app_token: this.config.appToken,
            table_id: tableId,
            record_id: params.recordId,
          },
        }),
      );
      return ok(undefined);
    } catch (e) {
      return err(makeError(ErrorCode.FEISHU_API_ERROR, 'delete failed', e));
    }
  }

  async link(params: LinkParams): Promise<Result<void>> {
    const tableId = this.tid(params.fromTable);
    try {
      await this.call(() =>
        this.larkClient.bitable.appTableRecord.update({
          path: {
            app_token: this.config.appToken,
            table_id: tableId,
            record_id: params.fromRecordId,
          },
          data: {
            fields: toLarkFields({
              [params.fieldName]: params.toRecordIds.map((id) => ({ record_id: id })),
            }),
          },
        }),
      );
      return ok(undefined);
    } catch (e) {
      return err(makeError(ErrorCode.FEISHU_API_ERROR, 'link failed', e));
    }
  }
}

// ---------- 工厂函数（从环境变量读取配置）----------

export function createBitableClient(): LarkBitableClient {
  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
  };

  return new LarkBitableClient({
    appId: required('LARK_APP_ID'),
    appSecret: required('LARK_APP_SECRET'),
    appToken: required('BITABLE_APP_TOKEN'),
    tableIds: {
      memory: required('BITABLE_TABLE_MEMORY'),
      decision: required('BITABLE_TABLE_DECISION'),
      todo: required('BITABLE_TABLE_TODO'),
      knowledge: required('BITABLE_TABLE_KNOWLEDGE'),
    },
  });
}
