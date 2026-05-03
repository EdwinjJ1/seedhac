/**
 * MemoryStore 接口声明 — 实现由 M2（feat/memory-m2-store）提供。
 *
 * 此文件仅用于让 M3 在 M2 未合并时也能通过 TypeScript 编译。
 * M2 合并后此文件会被替换为完整实现，export 签名须保持兼容。
 */

import type { MemoryKind, MemoryRecord, Result } from '@seedhac/contracts';

export interface MemoryStore {
  read(kind: MemoryKind, chatId: string, key: string): Promise<Result<MemoryRecord | null>>;
  search(
    chatId: string,
    query: string,
    opts?: { limit?: number; kind?: MemoryKind },
  ): Promise<Result<readonly MemoryRecord[]>>;
}
