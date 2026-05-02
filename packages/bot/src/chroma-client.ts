/**
 * ChromaClient — 向量库 CRUD adapter。
 *
 * 约束（issue #17）：
 *   - collection 名固定为 `messages`
 *   - metadata 含 chatId / userId / messageId / timestamp
 *   - search 按 chatId 过滤，返回 top-K 条
 *   - 所有异步操作返回 Result<T>，不 throw
 */

import { ChromaClient as Chroma, type Collection } from 'chromadb';
import { type Result, ok, err, ErrorCode, makeError } from '@seedhac/contracts';

export interface ChromaConfig {
  readonly host?: string;
}

export interface MessageDocument {
  readonly messageId: string;
  readonly chatId: string;
  readonly userId: string;
  readonly content: string;
  readonly timestamp: number;
  readonly embedding: number[];
}

export interface SearchHit {
  readonly messageId: string;
  readonly chatId: string;
  readonly userId: string;
  readonly content: string;
  readonly timestamp: number;
  readonly distance: number;
}

const COLLECTION_NAME = 'messages';

export class ChromaClient {
  private readonly chroma: Chroma;
  private collection: Collection | null = null;

  constructor(config: ChromaConfig = {}) {
    this.chroma = new Chroma({ path: config.host ?? 'http://localhost:8000' });
  }

  private async getCollection(): Promise<Result<Collection>> {
    try {
      if (!this.collection) {
        this.collection = await this.chroma.getOrCreateCollection({ name: COLLECTION_NAME });
      }
      return ok(this.collection);
    } catch (e) {
      return err(makeError(ErrorCode.UNKNOWN, 'chroma: failed to get collection', e));
    }
  }

  async insert(doc: MessageDocument): Promise<Result<void>> {
    const colResult = await this.getCollection();
    if (!colResult.ok) return colResult;
    try {
      await colResult.value.add({
        ids: [doc.messageId],
        embeddings: [doc.embedding],
        documents: [doc.content],
        metadatas: [
          {
            chatId: doc.chatId,
            userId: doc.userId,
            messageId: doc.messageId,
            timestamp: doc.timestamp,
          },
        ],
      });
      return ok(undefined);
    } catch (e) {
      return err(makeError(ErrorCode.UNKNOWN, 'chroma: insert failed', e));
    }
  }

  async search(chatId: string, queryEmbedding: number[], topK = 5): Promise<Result<SearchHit[]>> {
    const colResult = await this.getCollection();
    if (!colResult.ok) return colResult;
    try {
      const results = await colResult.value.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK,
        ...(chatId ? { where: { chatId } } : {}),
      });

      const ids = results.ids[0] ?? [];
      const distances = results.distances?.[0] ?? [];
      const metadatas = results.metadatas[0] ?? [];
      const documents = results.documents[0] ?? [];

      return ok(
        ids.map((id, i) => ({
          messageId: id,
          chatId: (metadatas[i]?.['chatId'] as string) ?? '',
          userId: (metadatas[i]?.['userId'] as string) ?? '',
          content: documents[i] ?? '',
          timestamp: (metadatas[i]?.['timestamp'] as number) ?? 0,
          distance: distances[i] ?? 0,
        })),
      );
    } catch (e) {
      return err(makeError(ErrorCode.UNKNOWN, 'chroma: search failed', e));
    }
  }

  async deleteCollection(): Promise<Result<void>> {
    try {
      await this.chroma.deleteCollection({ name: COLLECTION_NAME });
      this.collection = null;
      return ok(undefined);
    } catch (e) {
      return err(makeError(ErrorCode.UNKNOWN, 'chroma: deleteCollection failed', e));
    }
  }
}

export function createChromaClient(): ChromaClient {
  return new ChromaClient({ host: process.env['CHROMA_HOST'] ?? 'http://localhost:8000' });
}
