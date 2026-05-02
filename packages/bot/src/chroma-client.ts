/**
 * ChromaClient — 向量库 CRUD adapter。
 *
 * 约束（issue #17）：
 *   - collection 名固定为 `messages`
 *   - metadata 含 chatId / userId / messageId / timestamp
 *   - search 按 chatId 过滤，返回 top-K 条
 */

import { ChromaClient as Chroma, type Collection } from 'chromadb';

export interface ChromaConfig {
  readonly host?: string; // 默认 http://localhost:8000
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

  private async getCollection(): Promise<Collection> {
    if (!this.collection) {
      this.collection = await this.chroma.getOrCreateCollection({ name: COLLECTION_NAME });
    }
    return this.collection;
  }

  async insert(doc: MessageDocument): Promise<void> {
    const col = await this.getCollection();
    await col.add({
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
  }

  async search(chatId: string, queryEmbedding: number[], topK = 5): Promise<SearchHit[]> {
    const col = await this.getCollection();
    const results = await col.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      where: { chatId },
    });

    const ids = results.ids[0] ?? [];
    const distances = results.distances?.[0] ?? [];
    const metadatas = results.metadatas[0] ?? [];
    const documents = results.documents[0] ?? [];

    return ids.map((id, i) => ({
      messageId: id,
      chatId: (metadatas[i]?.['chatId'] as string) ?? '',
      userId: (metadatas[i]?.['userId'] as string) ?? '',
      content: documents[i] ?? '',
      timestamp: (metadatas[i]?.['timestamp'] as number) ?? 0,
      distance: distances[i] ?? 0,
    }));
  }

  async deleteCollection(): Promise<void> {
    await this.chroma.deleteCollection({ name: COLLECTION_NAME });
    this.collection = null;
  }
}

export function createChromaClient(): ChromaClient {
  return new ChromaClient({ host: process.env['CHROMA_HOST'] ?? 'http://localhost:8000' });
}
